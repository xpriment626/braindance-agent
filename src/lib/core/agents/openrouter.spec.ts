import { describe, it, expect } from 'vitest';
import { createOpenRouterProvider } from './openrouter';
import type { ChatMessage, ToolDef } from './llm';

// ─── Fake fetch ──────────────────────────────────────────
// Records requests, returns canned JSON responses. Each test controls the
// response shape so we can exercise text, tool-call, and error paths.

interface RecordedRequest {
	url: string;
	body: unknown;
	headers: Record<string, string>;
}

function fakeFetch(responseJson: unknown, status = 200) {
	const recorded: RecordedRequest[] = [];
	const fn: typeof fetch = async (input, init) => {
		const url = typeof input === 'string' ? input : input.toString();
		const headers: Record<string, string> = {};
		if (init?.headers) {
			const h = new Headers(init.headers);
			h.forEach((v, k) => (headers[k] = v));
		}
		recorded.push({
			url,
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
			headers
		});
		return new Response(JSON.stringify(responseJson), {
			status,
			headers: { 'Content-Type': 'application/json' }
		});
	};
	return { fn, recorded };
}

const USER_MSG: ChatMessage = { role: 'user', content: 'hello' };

describe('OpenRouter provider', () => {
	it('sends Bearer auth, model, and messages to chat/completions', async () => {
		const { fn, recorded } = fakeFetch({
			choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }]
		});
		const provider = createOpenRouterProvider({ apiKey: 'sk-test', fetch: fn });

		await provider.generate({
			model: 'moonshotai/kimi-k2.6',
			system: 'be terse',
			messages: [USER_MSG]
		});

		expect(recorded[0].url).toContain('/chat/completions');
		expect(recorded[0].headers.authorization).toBe('Bearer sk-test');
		const body = recorded[0].body as Record<string, unknown>;
		expect(body.model).toBe('moonshotai/kimi-k2.6');
		const messages = body.messages as Array<{ role: string; content: string }>;
		expect(messages[0]).toEqual({ role: 'system', content: 'be terse' });
		expect(messages[1]).toEqual({ role: 'user', content: 'hello' });
	});

	it('parses a text response into GenerateResult', async () => {
		const { fn } = fakeFetch({
			choices: [{ message: { content: 'the answer' }, finish_reason: 'stop' }],
			usage: { prompt_tokens: 10, completion_tokens: 3 }
		});
		const provider = createOpenRouterProvider({ apiKey: 'sk', fetch: fn });

		const result = await provider.generate({
			model: 'm',
			system: '',
			messages: [USER_MSG]
		});

		expect(result.text).toBe('the answer');
		expect(result.toolCalls).toEqual([]);
		expect(result.stopReason).toBe('end_turn');
		expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 3 });
	});

	it('translates tool definitions into OpenAI function-call format', async () => {
		const { fn, recorded } = fakeFetch({
			choices: [{ message: { content: null }, finish_reason: 'stop' }]
		});
		const provider = createOpenRouterProvider({ apiKey: 'sk', fetch: fn });
		const tool: ToolDef = {
			name: 'submit_audit',
			description: 'return the audit report',
			inputSchema: { type: 'object', properties: { summary: { type: 'string' } } }
		};

		await provider.generate({
			model: 'm',
			system: '',
			messages: [USER_MSG],
			tools: [tool]
		});

		const body = recorded[0].body as Record<string, unknown>;
		const tools = body.tools as Array<{ type: string; function: Record<string, unknown> }>;
		expect(tools[0].type).toBe('function');
		expect(tools[0].function.name).toBe('submit_audit');
		expect(tools[0].function.parameters).toEqual(tool.inputSchema);
	});

	it('parses tool_calls and maps stopReason to tool_use', async () => {
		const { fn } = fakeFetch({
			choices: [
				{
					message: {
						content: null,
						tool_calls: [
							{
								id: 'call_abc',
								type: 'function',
								function: {
									name: 'search_web',
									arguments: JSON.stringify({ query: 'agents' })
								}
							}
						]
					},
					finish_reason: 'tool_calls'
				}
			]
		});
		const provider = createOpenRouterProvider({ apiKey: 'sk', fetch: fn });

		const result = await provider.generate({
			model: 'm',
			system: '',
			messages: [USER_MSG]
		});

		expect(result.stopReason).toBe('tool_use');
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0].id).toBe('call_abc');
		expect(result.toolCalls[0].name).toBe('search_web');
		expect(result.toolCalls[0].input).toEqual({ query: 'agents' });
	});

	it('serializes assistant + tool messages correctly on replay', async () => {
		const { fn, recorded } = fakeFetch({
			choices: [{ message: { content: 'done' }, finish_reason: 'stop' }]
		});
		const provider = createOpenRouterProvider({ apiKey: 'sk', fetch: fn });

		await provider.generate({
			model: 'm',
			system: '',
			messages: [
				USER_MSG,
				{
					role: 'assistant',
					content: '',
					toolCalls: [{ id: 'c1', name: 'search_web', input: { query: 'x' } }]
				},
				{ role: 'tool', toolCallId: 'c1', content: '{"results":[]}' }
			]
		});

		const body = recorded[0].body as Record<string, unknown>;
		const messages = body.messages as Array<Record<string, unknown>>;
		const assistant = messages.find((m) => m.role === 'assistant')!;
		expect(assistant.tool_calls).toBeDefined();
		const tool = messages.find((m) => m.role === 'tool')!;
		expect(tool.tool_call_id).toBe('c1');
		expect(tool.content).toBe('{"results":[]}');
	});

	it('throws with status code + body snippet on non-2xx', async () => {
		const { fn } = fakeFetch({ error: { message: 'rate limited' } }, 429);
		const provider = createOpenRouterProvider({ apiKey: 'sk', fetch: fn });

		await expect(
			provider.generate({ model: 'm', system: '', messages: [USER_MSG] })
		).rejects.toThrow(/429/);
	});

	it('passes through reasoning_details when present', async () => {
		const { fn } = fakeFetch({
			choices: [
				{
					message: {
						content: 'answer',
						reasoning_details: [{ type: 'thought', text: 'internal trace' }]
					},
					finish_reason: 'stop'
				}
			]
		});
		const provider = createOpenRouterProvider({ apiKey: 'sk', fetch: fn });

		const result = await provider.generate({
			model: 'moonshotai/kimi-k2.6',
			system: '',
			messages: [USER_MSG]
		});

		expect(result.reasoningDetails).toEqual([{ type: 'thought', text: 'internal trace' }]);
	});
});
