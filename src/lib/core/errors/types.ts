// Typed error subclasses thrown across the core lib. normalizeError() dispatches
// on instanceof to map these to WorkflowRunError shape. Plain Error throws still
// flow through the message-regex fallback in normalize.ts.

import type { AgentName } from './contract';

export class OpenRouterError extends Error {
	constructor(
		public readonly statusCode: number,
		public readonly bodySnippet: string,
		message?: string
	) {
		super(message ?? `OpenRouter request failed: ${statusCode}`);
		this.name = 'OpenRouterError';
	}
}

export class OpenRouterTimeoutError extends Error {
	constructor(public readonly timeoutMs: number) {
		super(`OpenRouter request timed out after ${timeoutMs}ms`);
		this.name = 'OpenRouterTimeoutError';
	}
}

export type OpenRouterMalformedKind = 'not-object' | 'no-choices' | 'choice-not-object';

export class OpenRouterMalformedResponseError extends Error {
	constructor(public readonly kind: OpenRouterMalformedKind) {
		super(messageForMalformedKind(kind));
		this.name = 'OpenRouterMalformedResponseError';
	}
}

function messageForMalformedKind(kind: OpenRouterMalformedKind): string {
	switch (kind) {
		case 'not-object':
			return 'OpenRouter response was not a JSON object';
		case 'no-choices':
			return 'OpenRouter response had no choices';
		case 'choice-not-object':
			return 'OpenRouter response choice was not an object';
	}
}

export class McpNotConfiguredError extends Error {
	constructor(public readonly serverName: string) {
		super(`MCP server "${serverName}" has neither command nor url`);
		this.name = 'McpNotConfiguredError';
	}
}

export type AgentProtocolKind = 'no-tool-call' | 'iteration-limit' | 'invalid-output';

export class AgentProtocolError extends Error {
	constructor(
		public readonly kind: AgentProtocolKind,
		public readonly agent: AgentName,
		message: string
	) {
		super(message);
		this.name = 'AgentProtocolError';
	}
}

export type ValidationKind =
	| 'topic-not-found'
	| 'input-type'
	| 'briefing-card'
	| 'run-state'
	| 'signal-ownership'
	| 'config'
	| 'env';

export class ValidationError extends Error {
	constructor(public readonly kind: ValidationKind, message: string) {
		super(message);
		this.name = 'ValidationError';
	}
}
