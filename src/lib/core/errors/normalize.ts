// The single boundary that converts raw thrown errors into the WorkflowRunError
// contract. Every catch site that persists to workflow_runs.error or
// agent_runs.error must route through this function.
//
// Dispatch order:
//   1. Already-normalized → passthrough
//   2. Typed subclass → instanceof dispatch
//   3. Plain Error → message-regex fallback for legacy throws
//   4. INTERNAL fallback (always succeeds)

import type { WorkflowRunError, AgentName } from './contract';
import { isValidWorkflowRunError } from './contract';
import {
	OpenRouterError,
	OpenRouterMalformedResponseError,
	McpNotConfiguredError,
	AgentProtocolError,
	ValidationError,
	type AgentProtocolKind,
	type ValidationKind
} from './types';
import { ChannelUnavailableError } from '../channels/types';
import { scrub } from './scrub';

export interface NormalizeContext {
	agent?: AgentName;
}

// ─── Logger injection ────────────────────────────────────────
//
// Default behavior: write JSON-encoded debug payload to stderr. Tests
// override this with a noop or a capture function.

type LogFn = (line: string) => void;

const DEFAULT_LOGGER: LogFn = (line) => {
	process.stderr.write(line + '\n');
};

let logger: LogFn = DEFAULT_LOGGER;

export function setNormalizeLogger(fn: LogFn | undefined): void {
	logger = fn ?? DEFAULT_LOGGER;
}

// ─── Main entry point ────────────────────────────────────────

export function normalizeError(e: unknown, ctx?: NormalizeContext): WorkflowRunError {
	// Already-normalized errors short-circuit before scrubbing+logging — they
	// went through this function once already, no need to repeat the work and
	// double-emit log lines.
	if (isValidWorkflowRunError(e)) return e;
	const normalized = dispatch(e, ctx);
	const scrubbed: WorkflowRunError = { ...normalized, message: scrub(normalized.message) };
	emitLog(scrubbed, e);
	return scrubbed;
}

function dispatch(e: unknown, ctx?: NormalizeContext): WorkflowRunError {
	// Typed subclass dispatch.
	if (e instanceof OpenRouterError) return fromOpenRouter(e, ctx);
	if (e instanceof OpenRouterMalformedResponseError) return fromOpenRouterMalformed(e, ctx);
	if (e instanceof ChannelUnavailableError) return fromChannelUnavailable(e, ctx);
	if (e instanceof McpNotConfiguredError) return fromMcpNotConfigured(e, ctx);
	if (e instanceof AgentProtocolError) return fromAgentProtocol(e);
	if (e instanceof ValidationError) return fromValidation(e, ctx);

	// Untyped Error / non-Error → fallback layer.
	return fallback(e, ctx);
}

// ─── Typed subclass mappers ──────────────────────────────────

function fromOpenRouter(e: OpenRouterError, ctx?: NormalizeContext): WorkflowRunError {
	const status = e.statusCode;
	let code: string;
	let category: WorkflowRunError['category'];
	let hint: string | undefined;

	if (status === 401 || status === 403) {
		code = 'OPENROUTER_AUTH';
		category = 'fatal';
		hint = 'Check OPENROUTER_API_KEY in your environment.';
	} else if (status === 400) {
		code = 'OPENROUTER_BAD_REQUEST';
		category = 'fatal';
		hint = 'Invalid request — check model name and request shape.';
	} else if (status === 429) {
		code = 'OPENROUTER_RATE_LIMITED';
		category = 'transient';
	} else if (status >= 500 && status < 600) {
		code = 'OPENROUTER_UPSTREAM';
		category = 'transient';
	} else {
		// Unusual non-success status (e.g., 3xx redirect). Treat as fatal so it
		// surfaces visibly rather than getting silently retried.
		code = 'OPENROUTER_BAD_REQUEST';
		category = 'fatal';
	}

	return withAgent(
		{
			category,
			code,
			message: e.message,
			source: { kind: 'llm', name: 'openrouter', statusCode: status },
			...(hint && { hint })
		},
		ctx
	);
}

function fromOpenRouterMalformed(
	e: OpenRouterMalformedResponseError,
	ctx?: NormalizeContext
): WorkflowRunError {
	return withAgent(
		{
			category: 'transient',
			code: 'OPENROUTER_MALFORMED_RESPONSE',
			message: e.message,
			source: { kind: 'llm', name: 'openrouter' }
		},
		ctx
	);
}

function fromChannelUnavailable(
	e: ChannelUnavailableError,
	ctx?: NormalizeContext
): WorkflowRunError {
	return withAgent(
		{
			category: 'transient',
			code: 'CHANNEL_UNAVAILABLE',
			message: e.message,
			source: { kind: 'channel', name: e.channel }
		},
		ctx
	);
}

function fromMcpNotConfigured(
	e: McpNotConfiguredError,
	ctx?: NormalizeContext
): WorkflowRunError {
	return withAgent(
		{
			category: 'fatal',
			code: 'MCP_NOT_CONFIGURED',
			message: e.message,
			source: { kind: 'mcp', name: e.serverName },
			hint: 'Add a "command" or "url" to this MCP server entry in config.yaml.'
		},
		ctx
	);
}

function fromAgentProtocol(e: AgentProtocolError): WorkflowRunError {
	const codeByKind: Record<AgentProtocolKind, string> = {
		'no-tool-call': 'AGENT_NO_TOOL_CALL',
		'iteration-limit': 'AGENT_ITERATION_LIMIT',
		'invalid-output': 'AGENT_INVALID_OUTPUT'
	};
	// AgentProtocolError carries its own agent name — that wins over ctx.
	return {
		category: 'agent',
		code: codeByKind[e.kind],
		message: e.message,
		agent: e.agent
	};
}

function fromValidation(e: ValidationError, ctx?: NormalizeContext): WorkflowRunError {
	const codeByKind: Record<ValidationKind, string> = {
		'topic-not-found': 'VALIDATION_TOPIC_NOT_FOUND',
		'input-type': 'VALIDATION_INPUT_TYPE',
		'briefing-card': 'VALIDATION_BRIEFING_CARD',
		'run-state': 'VALIDATION_RUN_STATE',
		'signal-ownership': 'VALIDATION_SIGNAL_OWNERSHIP',
		config: 'VALIDATION_CONFIG',
		env: 'VALIDATION_ENV'
	};
	// 'env' kind is infrastructure — categorize as fatal so UI doesn't tell
	// users to fix their input when it's actually their environment.
	const category: WorkflowRunError['category'] = e.kind === 'env' ? 'fatal' : 'validation';
	return withAgent({ category, code: codeByKind[e.kind], message: e.message }, ctx);
}

// ─── Fallback layer ──────────────────────────────────────────

interface MessagePattern {
	pattern: RegExp;
	code: string;
	category: WorkflowRunError['category'];
}

const MESSAGE_PATTERNS: MessagePattern[] = [
	{ pattern: /topic\s+["']?[^"']*["']?\s+not\s+found/i, code: 'VALIDATION_TOPIC_NOT_FOUND', category: 'validation' },
	{ pattern: /^Topic\s+not\s+found:/, code: 'VALIDATION_TOPIC_NOT_FOUND', category: 'validation' },
	{ pattern: /workflow_run\s+".*"\s+is\s+\w+,\s*expected/i, code: 'VALIDATION_RUN_STATE', category: 'validation' },
	{ pattern: /workflow_run\s+".*"\s+(not\s+found|vanished)/i, code: 'VALIDATION_RUN_STATE', category: 'validation' },
	{ pattern: /signal\s+".*"\s+belongs\s+to\s+topic/i, code: 'VALIDATION_SIGNAL_OWNERSHIP', category: 'validation' },
	{ pattern: /signal\s+".*"\s+(not\s+found|is\s+\w+,\s*expected|vanished)/i, code: 'VALIDATION_RUN_STATE', category: 'validation' },
	{ pattern: /discovery_report\s+".*"\s+(not\s+found|is\s+\w+,\s*expected|vanished|has\s+no\s+proposals)/i, code: 'VALIDATION_RUN_STATE', category: 'validation' },
	{ pattern: /not\s+yet\s+supported/i, code: 'VALIDATION_INPUT_TYPE', category: 'validation' },
	{ pattern: /APPDATA\s+env\s+required/i, code: 'VALIDATION_ENV', category: 'fatal' },
	{ pattern: /config\.yaml\s+must\s+be/i, code: 'VALIDATION_CONFIG', category: 'validation' }
];

function fallback(e: unknown, ctx?: NormalizeContext): WorkflowRunError {
	const message = extractMessage(e);
	for (const { pattern, code, category } of MESSAGE_PATTERNS) {
		if (pattern.test(message)) {
			return withAgent({ category, code, message }, ctx);
		}
	}
	return withAgent({ category: 'fatal', code: 'INTERNAL', message }, ctx);
}

function extractMessage(e: unknown): string {
	if (e === null || e === undefined) return 'unknown error';
	if (e instanceof Error) return e.message || e.name || 'unknown error';
	if (typeof e === 'string') return e;
	try {
		return String(e);
	} catch {
		return 'unknown error';
	}
}

// ─── Helpers ─────────────────────────────────────────────────

function withAgent(
	err: WorkflowRunError,
	ctx?: NormalizeContext
): WorkflowRunError {
	if (err.agent || !ctx?.agent) return err;
	return { ...err, agent: ctx.agent };
}

function emitLog(structured: WorkflowRunError, raw: unknown): void {
	const payload = {
		ts: new Date().toISOString(),
		level: 'error',
		error: structured,
		stack: raw instanceof Error ? raw.stack : undefined,
		raw: raw instanceof Error ? undefined : extractMessage(raw)
	};
	try {
		logger(JSON.stringify(payload));
	} catch {
		// Logger must never throw upward — we're already in an error path.
	}
}
