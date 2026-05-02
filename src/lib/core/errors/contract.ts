// Error contract — types stored in workflow_runs.error and agent_runs.error
// (TEXT columns containing JSON-stringified WorkflowRunError objects).
// See ../../../../docs/braindance-agent-design/superpowers/specs/2026-05-01-error-handling-contract.md.

export type ErrorCategory = 'validation' | 'transient' | 'fatal' | 'agent';

export type AgentName = 'discover' | 'audit' | 'prune';

export type ErrorSourceKind = 'llm' | 'mcp' | 'channel';

export interface ErrorSource {
	kind: ErrorSourceKind;
	name: string;
	statusCode?: number;
}

export interface WorkflowRunError {
	category: ErrorCategory;
	code: string;
	message: string;
	agent?: AgentName;
	source?: ErrorSource;
	hint?: string;
}

const CATEGORIES: ReadonlySet<ErrorCategory> = new Set([
	'validation',
	'transient',
	'fatal',
	'agent'
]);

const AGENT_NAMES: ReadonlySet<AgentName> = new Set(['discover', 'audit', 'prune']);

const SOURCE_KINDS: ReadonlySet<ErrorSourceKind> = new Set(['llm', 'mcp', 'channel']);

export function serializeWorkflowRunError(e: WorkflowRunError): string {
	return JSON.stringify(e);
}

export function parseWorkflowRunError(s: string | null): WorkflowRunError | null {
	if (s === null || s === undefined) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(s);
	} catch {
		return legacyWrap(s);
	}
	if (isValidWorkflowRunError(parsed)) return parsed;
	return legacyWrap(s);
}

function legacyWrap(s: string): WorkflowRunError {
	return { category: 'fatal', code: 'INTERNAL', message: s };
}

export function isValidWorkflowRunError(value: unknown): value is WorkflowRunError {
	if (!isRecord(value)) return false;
	if (typeof value.category !== 'string' || !CATEGORIES.has(value.category as ErrorCategory)) {
		return false;
	}
	if (typeof value.code !== 'string' || value.code.length === 0) return false;
	if (typeof value.message !== 'string') return false;
	if (value.agent !== undefined) {
		if (typeof value.agent !== 'string' || !AGENT_NAMES.has(value.agent as AgentName)) {
			return false;
		}
	}
	if (value.source !== undefined) {
		if (!isRecord(value.source)) return false;
		const kind = value.source.kind;
		if (typeof kind !== 'string' || !SOURCE_KINDS.has(kind as ErrorSourceKind)) return false;
		if (typeof value.source.name !== 'string') return false;
		if (value.source.statusCode !== undefined && typeof value.source.statusCode !== 'number') {
			return false;
		}
	}
	if (value.hint !== undefined && typeof value.hint !== 'string') return false;
	return true;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
