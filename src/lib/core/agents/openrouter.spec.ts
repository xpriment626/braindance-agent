import { describe, it, expect } from 'vitest';
import { createOpenRouterProvider } from './openrouter';
import type { ChatMessage, ToolDef } from './llm';
import {
	OpenRouterError,
	OpenRouterMalformedResponseError
} from '../errors/types';

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

// Variant that serves a different response per call. Used by retry tests
// to assert "1st call fails, 2nd call succeeds" type sequences.
interface SequencedResponse {
	status: number;
	body: unknown;
	headers?: Record<string, string>;
}

function sequencedFakeFetch(responses: SequencedResponse[]) {
	const recorded: RecordedRequest[] = [];
	let i = 0;
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
		if (i >= responses.length) {
			throw new Error(`sequencedFakeFetch exhausted at call ${i + 1}`);
		}
		const r = responses[i++];
		return new Response(JSON.stringify(r.body), {
			status: r.status,
			headers: { 'Content-Type': 'application/json', ...r.headers }
		});
	};
	return { fn, recorded };
}

const NOOP_SLEEP = async (_ms: number) => {};

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

	it('throws OpenRouterError with status + body on non-retryable failures', async () => {
		const { fn } = fakeFetch({ error: { message: 'unauthorized' } }, 401);
		const provider = createOpenRouterProvider({ apiKey: 'sk', fetch: fn, sleep: NOOP_SLEEP });

		await expect(
			provider.generate({ model: 'm', system: '', messages: [USER_MSG] })
		).rejects.toThrowError(OpenRouterError);
		await expect(
			provider.generate({ model: 'm', system: '', messages: [USER_MSG] })
		).rejects.toMatchObject({ statusCode: 401 });
	});

	// ─── Retry mechanic ──────────────────────────────────────

	it('retries once on 429 and succeeds on the second call', async () => {
		const { fn, recorded } = sequencedFakeFetch([
			{ status: 429, body: { error: { message: 'rl' } } },
			{
				status: 200,
				body: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }
			}
		]);
		const provider = createOpenRouterProvider({ apiKey: 'sk', fetch: fn, sleep: NOOP_SLEEP });

		const result = await provider.generate({
			model: 'm',
			system: '',
			messages: [USER_MSG]
		});
		expect(result.text).toBe('ok');
		expect(recorded).toHaveLength(2);
	});

	it('honors Retry-After header on 429', async () => {
		const sleeps: number[] = [];
		const { fn } = sequencedFakeFetch([
			{ status: 429, body: { error: 'rl' }, headers: { 'retry-after': '3' } },
			{ status: 200, body: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } }
		]);
		const provider = createOpenRouterProvider({
			apiKey: 'sk',
			fetch: fn,
			sleep: async (ms) => {
				sleeps.push(ms);
			}
		});

		await provider.generate({ model: 'm', system: '', messages: [USER_MSG] });
		expect(sleeps).toEqual([3000]);
	});

	it('uses default 1s backoff when 429 has no Retry-After', async () => {
		const sleeps: number[] = [];
		const { fn } = sequencedFakeFetch([
			{ status: 429, body: { error: 'rl' } },
			{ status: 200, body: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } }
		]);
		const provider = createOpenRouterProvider({
			apiKey: 'sk',
			fetch: fn,
			sleep: async (ms) => {
				sleeps.push(ms);
			}
		});

		await provider.generate({ model: 'm', system: '', messages: [USER_MSG] });
		expect(sleeps).toEqual([1000]);
	});

	it('retries once on 5xx with 2s backoff', async () => {
		const sleeps: number[] = [];
		const { fn, recorded } = sequencedFakeFetch([
			{ status: 502, body: { error: 'bad gateway' } },
			{ status: 200, body: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } }
		]);
		const provider = createOpenRouterProvider({
			apiKey: 'sk',
			fetch: fn,
			sleep: async (ms) => {
				sleeps.push(ms);
			}
		});

		await provider.generate({ model: 'm', system: '', messages: [USER_MSG] });
		expect(sleeps).toEqual([2000]);
		expect(recorded).toHaveLength(2);
	});

	it('throws OpenRouterError(429) after retry is also 429', async () => {
		const { fn, recorded } = sequencedFakeFetch([
			{ status: 429, body: { error: 'rl' } },
			{ status: 429, body: { error: 'still rl' } }
		]);
		const provider = createOpenRouterProvider({ apiKey: 'sk', fetch: fn, sleep: NOOP_SLEEP });

		await expect(
			provider.generate({ model: 'm', system: '', messages: [USER_MSG] })
		).rejects.toMatchObject({ statusCode: 429 });
		expect(recorded).toHaveLength(2);
	});

	it('throws OpenRouterError(500) after retry is also 5xx', async () => {
		const { fn, recorded } = sequencedFakeFetch([
			{ status: 503, body: { error: 'down' } },
			{ status: 503, body: { error: 'still down' } }
		]);
		const provider = createOpenRouterProvider({ apiKey: 'sk', fetch: fn, sleep: NOOP_SLEEP });

		await expect(
			provider.generate({ model: 'm', system: '', messages: [USER_MSG] })
		).rejects.toMatchObject({ statusCode: 503 });
		expect(recorded).toHaveLength(2);
	});

	it('does not retry on 4xx (non-429)', async () => {
		const { fn, recorded } = sequencedFakeFetch([
			{ status: 400, body: { error: 'bad request' } }
		]);
		const provider = createOpenRouterProvider({ apiKey: 'sk', fetch: fn, sleep: NOOP_SLEEP });

		await expect(
			provider.generate({ model: 'm', system: '', messages: [USER_MSG] })
		).rejects.toMatchObject({ statusCode: 400 });
		expect(recorded).toHaveLength(1);
	});

	it('does not retry on 200', async () => {
		const { fn, recorded } = sequencedFakeFetch([
			{ status: 200, body: { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] } }
		]);
		const provider = createOpenRouterProvider({ apiKey: 'sk', fetch: fn, sleep: NOOP_SLEEP });

		await provider.generate({ model: 'm', system: '', messages: [USER_MSG] });
		expect(recorded).toHaveLength(1);
	});

	// ─── Malformed response ──────────────────────────────────

	it('throws OpenRouterMalformedResponseError when payload is not an object', async () => {
		const { fn } = fakeFetch('not-an-object');
		const provider = createOpenRouterProvider({ apiKey: 'sk', fetch: fn, sleep: NOOP_SLEEP });

		await expect(
			provider.generate({ model: 'm', system: '', messages: [USER_MSG] })
		).rejects.toThrowError(OpenRouterMalformedResponseError);
	});

	it('throws OpenRouterMalformedResponseError when there are no choices', async () => {
		const { fn } = fakeFetch({ usage: { prompt_tokens: 0 } });
		const provider = createOpenRouterProvider({ apiKey: 'sk', fetch: fn, sleep: NOOP_SLEEP });

		await expect(
			provider.generate({ model: 'm', system: '', messages: [USER_MSG] })
		).rejects.toThrowError(OpenRouterMalformedResponseError);
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
