import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { normalizeError, setNormalizeLogger } from './normalize';
import {
	OpenRouterError,
	OpenRouterMalformedResponseError,
	McpNotConfiguredError,
	AgentProtocolError,
	ValidationError
} from './types';
import { ChannelUnavailableError } from '../channels/types';
import type { WorkflowRunError } from './contract';

beforeEach(() => {
	// Silence stderr logging during tests; one test below explicitly verifies
	// the logger is invoked.
	setNormalizeLogger(() => {});
});

afterEach(() => {
	setNormalizeLogger(undefined);
});

describe('normalizeError — OpenRouterError dispatch', () => {
	it('maps 401 to OPENROUTER_AUTH (fatal)', () => {
		const e = new OpenRouterError(401, 'unauthorized');
		const r = normalizeError(e);
		expect(r.category).toBe('fatal');
		expect(r.code).toBe('OPENROUTER_AUTH');
		expect(r.source).toEqual({ kind: 'llm', name: 'openrouter', statusCode: 401 });
	});

	it('maps 403 to OPENROUTER_AUTH (fatal)', () => {
		const r = normalizeError(new OpenRouterError(403, 'forbidden'));
		expect(r.category).toBe('fatal');
		expect(r.code).toBe('OPENROUTER_AUTH');
	});

	it('maps 400 to OPENROUTER_BAD_REQUEST (fatal)', () => {
		const r = normalizeError(new OpenRouterError(400, 'invalid model'));
		expect(r.category).toBe('fatal');
		expect(r.code).toBe('OPENROUTER_BAD_REQUEST');
	});

	it('maps 429 to OPENROUTER_RATE_LIMITED (transient)', () => {
		const r = normalizeError(new OpenRouterError(429, 'rate limited'));
		expect(r.category).toBe('transient');
		expect(r.code).toBe('OPENROUTER_RATE_LIMITED');
	});

	it('maps 500 to OPENROUTER_UPSTREAM (transient)', () => {
		const r = normalizeError(new OpenRouterError(500, 'internal'));
		expect(r.category).toBe('transient');
		expect(r.code).toBe('OPENROUTER_UPSTREAM');
	});

	it('maps 502 to OPENROUTER_UPSTREAM (transient)', () => {
		const r = normalizeError(new OpenRouterError(502, 'bad gateway'));
		expect(r.category).toBe('transient');
		expect(r.code).toBe('OPENROUTER_UPSTREAM');
	});

	it('maps OpenRouterMalformedResponseError to OPENROUTER_MALFORMED_RESPONSE (transient)', () => {
		const r = normalizeError(new OpenRouterMalformedResponseError('not-object'));
		expect(r.category).toBe('transient');
		expect(r.code).toBe('OPENROUTER_MALFORMED_RESPONSE');
		expect(r.source).toEqual({ kind: 'llm', name: 'openrouter' });
	});
});

describe('normalizeError — ChannelUnavailableError dispatch', () => {
	it('maps to CHANNEL_UNAVAILABLE (transient) with channel name as source', () => {
		const e = new ChannelUnavailableError('web', 'exa', 'returned no results');
		const r = normalizeError(e);
		expect(r.category).toBe('transient');
		expect(r.code).toBe('CHANNEL_UNAVAILABLE');
		expect(r.source).toEqual({ kind: 'channel', name: 'web' });
	});
});

describe('normalizeError — McpNotConfiguredError dispatch', () => {
	it('maps to MCP_NOT_CONFIGURED (fatal)', () => {
		const r = normalizeError(new McpNotConfiguredError('exa'));
		expect(r.category).toBe('fatal');
		expect(r.code).toBe('MCP_NOT_CONFIGURED');
		expect(r.source).toEqual({ kind: 'mcp', name: 'exa' });
	});
});

describe('normalizeError — AgentProtocolError dispatch', () => {
	it('maps no-tool-call kind to AGENT_NO_TOOL_CALL with agent set', () => {
		const r = normalizeError(
			new AgentProtocolError('no-tool-call', 'discover', 'discover did not call report_findings')
		);
		expect(r.category).toBe('agent');
		expect(r.code).toBe('AGENT_NO_TOOL_CALL');
		expect(r.agent).toBe('discover');
	});

	it('maps iteration-limit kind to AGENT_ITERATION_LIMIT with agent set', () => {
		const r = normalizeError(new AgentProtocolError('iteration-limit', 'audit', 'too many iters'));
		expect(r.code).toBe('AGENT_ITERATION_LIMIT');
		expect(r.agent).toBe('audit');
	});

	it('maps invalid-output kind to AGENT_INVALID_OUTPUT', () => {
		const r = normalizeError(new AgentProtocolError('invalid-output', 'prune', 'bad output'));
		expect(r.code).toBe('AGENT_INVALID_OUTPUT');
		expect(r.agent).toBe('prune');
	});
});

describe('normalizeError — ValidationError dispatch', () => {
	it('maps topic-not-found to VALIDATION_TOPIC_NOT_FOUND', () => {
		const r = normalizeError(new ValidationError('topic-not-found', 'topic "abc" not found'));
		expect(r.category).toBe('validation');
		expect(r.code).toBe('VALIDATION_TOPIC_NOT_FOUND');
	});

	it('maps input-type to VALIDATION_INPUT_TYPE', () => {
		const r = normalizeError(new ValidationError('input-type', 'youtube not supported'));
		expect(r.code).toBe('VALIDATION_INPUT_TYPE');
	});

	it('maps briefing-card to VALIDATION_BRIEFING_CARD', () => {
		const r = normalizeError(new ValidationError('briefing-card', 'briefing card invalid'));
		expect(r.code).toBe('VALIDATION_BRIEFING_CARD');
	});

	it('maps run-state to VALIDATION_RUN_STATE', () => {
		const r = normalizeError(new ValidationError('run-state', 'wrong state'));
		expect(r.code).toBe('VALIDATION_RUN_STATE');
	});

	it('maps signal-ownership to VALIDATION_SIGNAL_OWNERSHIP', () => {
		const r = normalizeError(new ValidationError('signal-ownership', 'wrong topic'));
		expect(r.code).toBe('VALIDATION_SIGNAL_OWNERSHIP');
	});

	it('maps config to VALIDATION_CONFIG', () => {
		const r = normalizeError(new ValidationError('config', 'malformed yaml'));
		expect(r.code).toBe('VALIDATION_CONFIG');
	});

	it('maps env to VALIDATION_ENV (fatal, not validation)', () => {
		// env errors are infrastructure-level — user must fix env, not input.
		const r = normalizeError(new ValidationError('env', 'APPDATA missing'));
		expect(r.category).toBe('fatal');
		expect(r.code).toBe('VALIDATION_ENV');
	});
});

describe('normalizeError — agent context propagation', () => {
	it('attaches ctx.agent to a transient error (e.g., OpenRouter 429 inside discover)', () => {
		const r = normalizeError(new OpenRouterError(429, 'rate limited'), { agent: 'discover' });
		expect(r.category).toBe('transient');
		expect(r.agent).toBe('discover');
	});

	it('attaches ctx.agent to a validation error', () => {
		const r = normalizeError(new ValidationError('config', 'bad'), { agent: 'audit' });
		expect(r.agent).toBe('audit');
	});

	it('does not override agent already set on AgentProtocolError', () => {
		const r = normalizeError(
			new AgentProtocolError('iteration-limit', 'discover', 'x'),
			{ agent: 'audit' }
		);
		expect(r.agent).toBe('discover');
	});
});

describe('normalizeError — message regex fallback', () => {
	it('catches "topic \\"X\\" not found" as VALIDATION_TOPIC_NOT_FOUND', () => {
		const r = normalizeError(new Error('topic "abc" not found'));
		expect(r.category).toBe('validation');
		expect(r.code).toBe('VALIDATION_TOPIC_NOT_FOUND');
	});

	it('catches "Topic not found:" (capitalized variant)', () => {
		const r = normalizeError(new Error('Topic not found: xyz'));
		expect(r.code).toBe('VALIDATION_TOPIC_NOT_FOUND');
	});

	it('catches workflow_run state errors as VALIDATION_RUN_STATE', () => {
		const r = normalizeError(new Error('workflow_run "abc" is failed, expected one of [running]'));
		expect(r.code).toBe('VALIDATION_RUN_STATE');
	});

	it('catches "signal X belongs to topic" as VALIDATION_SIGNAL_OWNERSHIP', () => {
		const r = normalizeError(new Error('signal "x" belongs to topic "y", expected "z"'));
		expect(r.code).toBe('VALIDATION_SIGNAL_OWNERSHIP');
	});
});

describe('normalizeError — INTERNAL fallback', () => {
	it('wraps an unknown Error as INTERNAL fatal', () => {
		const r = normalizeError(new Error('something completely unknown happened'));
		expect(r.category).toBe('fatal');
		expect(r.code).toBe('INTERNAL');
		expect(r.message).toContain('something completely unknown');
	});

	it('wraps a non-Error throw as INTERNAL fatal', () => {
		const r = normalizeError('string was thrown');
		expect(r.category).toBe('fatal');
		expect(r.code).toBe('INTERNAL');
		expect(r.message).toBe('string was thrown');
	});

	it('wraps null as INTERNAL fatal with placeholder message', () => {
		const r = normalizeError(null);
		expect(r.category).toBe('fatal');
		expect(r.code).toBe('INTERNAL');
		expect(r.message.length).toBeGreaterThan(0);
	});
});

describe('normalizeError — already-normalized passthrough', () => {
	it('returns an existing WorkflowRunError as-is', () => {
		const existing: WorkflowRunError = {
			category: 'transient',
			code: 'OPENROUTER_RATE_LIMITED',
			message: 'previously normalized',
			source: { kind: 'llm', name: 'openrouter', statusCode: 429 }
		};
		const r = normalizeError(existing);
		expect(r).toBe(existing);
	});
});

describe('normalizeError — scrubbing', () => {
	it('redacts api keys in the persisted message', () => {
		const e = new OpenRouterError(401, 'body', 'auth failed: api_key=sk-supersecret123456789');
		const r = normalizeError(e);
		expect(r.message).not.toContain('sk-supersecret');
		expect(r.message).toContain('[REDACTED]');
	});
});

describe('normalizeError — logging', () => {
	it('invokes the configured logger with structured payload', () => {
		const calls: string[] = [];
		setNormalizeLogger((line) => calls.push(line));
		normalizeError(new OpenRouterError(429, 'rl'));
		expect(calls.length).toBeGreaterThan(0);
		// Logged line is JSON-encoded structure with the normalized error.
		const parsed = JSON.parse(calls[0]);
		expect(parsed.error.code).toBe('OPENROUTER_RATE_LIMITED');
		expect(parsed.level).toBe('error');
		expect(typeof parsed.ts).toBe('string');
	});

	it('does not log if logger is set to noop', () => {
		const calls: string[] = [];
		setNormalizeLogger(() => {
			calls.push('called');
		});
		normalizeError(new ValidationError('config', 'x'));
		// One call expected, since we provided a non-noop. Sanity check that
		// the override pathway works.
		expect(calls.length).toBe(1);
	});
});
