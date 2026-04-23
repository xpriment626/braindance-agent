// LLM provider abstraction — tool-use-uniform interface that every capability
// agent shares. Agents without "real" tools still participate in the tool-use
// loop via a single synthetic finish tool; agents with real tools (discover)
// emit intermediate tool calls that the agent loop dispatches to channels.

export interface ToolDef {
	name: string;
	description: string;
	// JSON Schema object. We keep it loose — providers pass it through.
	inputSchema: Record<string, unknown>;
}

export interface ToolCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export type ChatMessage =
	| { role: 'user'; content: string }
	| { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
	| { role: 'tool'; toolCallId: string; content: string };

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'error';

export interface GenerateParams {
	model: string;
	system: string;
	messages: ChatMessage[];
	tools?: ToolDef[];
	maxTokens?: number;
}

export interface GenerateResult {
	text: string;
	toolCalls: ToolCall[];
	stopReason: StopReason;
	usage?: { inputTokens: number; outputTokens: number };
	// Some models (Kimi K2.6) surface reasoning traces. Optional passthrough.
	reasoningDetails?: unknown;
}

export interface LLMProvider {
	generate(params: GenerateParams): Promise<GenerateResult>;
}

// ─── Convenience constructors ─────────────────────────────

export function textResponse(text: string): GenerateResult {
	return { text, toolCalls: [], stopReason: 'end_turn' };
}

export function toolCallResponse(toolCalls: ToolCall[]): GenerateResult {
	return { text: '', toolCalls, stopReason: 'tool_use' };
}

// ─── Mock provider ────────────────────────────────────────

export interface MockLLMProvider extends LLMProvider {
	calls: GenerateParams[];
}

// Accepts one or more canned GenerateResults. Returns them in order and
// repeats the last one after the list is exhausted — matches how real agent
// loops will iterate (one initial response, then one per tool-result roundtrip).
export function createMockProvider(...responses: GenerateResult[]): MockLLMProvider {
	if (responses.length === 0) {
		throw new Error('createMockProvider requires at least one response');
	}
	const calls: GenerateParams[] = [];
	let index = 0;
	return {
		calls,
		async generate(params: GenerateParams): Promise<GenerateResult> {
			calls.push(params);
			const response = responses[index] ?? responses[responses.length - 1];
			index++;
			return response;
		}
	};
}
