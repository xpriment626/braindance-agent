import type {
	ChatMessage,
	GenerateParams,
	GenerateResult,
	LLMProvider,
	StopReason,
	ToolCall,
	ToolDef
} from './llm';
import { OpenRouterError, OpenRouterMalformedResponseError } from '../errors/types';

export interface OpenRouterOptions {
	apiKey: string;
	baseUrl?: string;
	// Injectable for testing; defaults to global fetch.
	fetch?: typeof fetch;
	// Injectable for testing; defaults to setTimeout-based sleep. Used by the
	// 429/5xx retry mechanic.
	sleep?: (ms: number) => Promise<void>;
	// Sent as OpenRouter attribution headers (optional but encouraged).
	appName?: string;
	appUrl?: string;
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_429_BACKOFF_MS = 1000;
const DEFAULT_5XX_BACKOFF_MS = 2000;

const defaultSleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

export function createOpenRouterProvider(opts: OpenRouterOptions): LLMProvider {
	const fetchImpl = opts.fetch ?? fetch;
	const sleep = opts.sleep ?? defaultSleep;
	const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;

	return {
		async generate(params: GenerateParams): Promise<GenerateResult> {
			const body = buildRequestBody(params);
			const headers: Record<string, string> = {
				authorization: `Bearer ${opts.apiKey}`,
				'content-type': 'application/json'
			};
			if (opts.appName) headers['x-title'] = opts.appName;
			if (opts.appUrl) headers['http-referer'] = opts.appUrl;

			const url = `${baseUrl}/chat/completions`;
			const requestInit: RequestInit = {
				method: 'POST',
				headers,
				body: JSON.stringify(body)
			};

			const response = await fetchWithRetry(fetchImpl, url, requestInit, sleep);

			if (!response.ok) {
				const text = await response.text();
				throw new OpenRouterError(
					response.status,
					text.slice(0, 200),
					`OpenRouter request failed: ${response.status} ${response.statusText} — ${text.slice(0, 200)}`
				);
			}

			const payload: unknown = await response.json();
			return parseResponse(payload);
		}
	};
}

// ─── Retry mechanic ───────────────────────────────────────
// Single retry on 429 (honoring Retry-After) and 5xx (2s backoff).
// All other status codes — including 4xx non-429 — return immediately;
// the caller throws OpenRouterError which normalizeError categorizes as
// fatal (auth, bad-request) or transient (429 after retry, 5xx after
// retry).

async function fetchWithRetry(
	fetchImpl: typeof fetch,
	url: string,
	init: RequestInit,
	sleep: (ms: number) => Promise<void>
): Promise<Response> {
	const first = await fetchImpl(url, init);
	if (!shouldRetry(first.status)) return first;

	const backoff = computeBackoff(first);
	await sleep(backoff);
	return fetchImpl(url, init);
}

function shouldRetry(status: number): boolean {
	return status === 429 || (status >= 500 && status < 600);
}

function computeBackoff(response: Response): number {
	if (response.status === 429) {
		const header = response.headers.get('retry-after');
		const parsed = parseRetryAfter(header);
		return parsed ?? DEFAULT_429_BACKOFF_MS;
	}
	return DEFAULT_5XX_BACKOFF_MS;
}

function parseRetryAfter(header: string | null): number | null {
	if (!header) return null;
	const trimmed = header.trim();
	// Numeric seconds form (most common).
	const seconds = Number(trimmed);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return seconds * 1000;
	}
	// HTTP-date form: convert to delay-from-now.
	const dateMs = Date.parse(trimmed);
	if (Number.isFinite(dateMs)) {
		const delay = dateMs - Date.now();
		return delay > 0 ? delay : 0;
	}
	return null;
}

// ─── Request building ─────────────────────────────────────

function buildRequestBody(params: GenerateParams): Record<string, unknown> {
	const messages: Array<Record<string, unknown>> = [];
	if (params.system) {
		messages.push({ role: 'system', content: params.system });
	}
	for (const msg of params.messages) {
		messages.push(serializeMessage(msg));
	}

	const body: Record<string, unknown> = {
		model: params.model,
		messages
	};
	if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
	if (params.tools && params.tools.length > 0) {
		body.tools = params.tools.map(toOpenAiFunction);
	}
	return body;
}

function serializeMessage(msg: ChatMessage): Record<string, unknown> {
	switch (msg.role) {
		case 'user':
			return { role: 'user', content: msg.content };
		case 'assistant': {
			const out: Record<string, unknown> = { role: 'assistant', content: msg.content };
			if (msg.toolCalls && msg.toolCalls.length > 0) {
				out.tool_calls = msg.toolCalls.map((c) => ({
					id: c.id,
					type: 'function',
					function: {
						name: c.name,
						arguments: JSON.stringify(c.input)
					}
				}));
			}
			return out;
		}
		case 'tool':
			return {
				role: 'tool',
				tool_call_id: msg.toolCallId,
				content: msg.content
			};
	}
}

function toOpenAiFunction(tool: ToolDef): Record<string, unknown> {
	return {
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema
		}
	};
}

// ─── Response parsing ─────────────────────────────────────

function parseResponse(payload: unknown): GenerateResult {
	if (!isRecord(payload)) {
		throw new OpenRouterMalformedResponseError('not-object');
	}
	const choices = payload.choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new OpenRouterMalformedResponseError('no-choices');
	}
	const choice = choices[0];
	if (!isRecord(choice)) {
		throw new OpenRouterMalformedResponseError('choice-not-object');
	}

	const message = isRecord(choice.message) ? choice.message : {};
	const text = asString(message.content) ?? '';
	const toolCalls = extractToolCalls(message);
	const stopReason = mapFinishReason(asString(choice.finish_reason));
	const usage = extractUsage(payload.usage);

	const result: GenerateResult = { text, toolCalls, stopReason };
	if (usage) result.usage = usage;
	if (message.reasoning_details !== undefined) {
		result.reasoningDetails = message.reasoning_details;
	}
	return result;
}

function extractToolCalls(message: Record<string, unknown>): ToolCall[] {
	const raw = message.tool_calls;
	if (!Array.isArray(raw)) return [];
	const out: ToolCall[] = [];
	for (const item of raw) {
		if (!isRecord(item)) continue;
		const id = asString(item.id);
		const fn = isRecord(item.function) ? item.function : null;
		const name = asString(fn?.name);
		const argsString = asString(fn?.arguments);
		if (!id || !name) continue;
		let input: Record<string, unknown> = {};
		if (argsString) {
			try {
				const parsed = JSON.parse(argsString);
				if (isRecord(parsed)) input = parsed;
			} catch {
				// Leave input empty if the model produced malformed JSON.
				// The agent loop will surface this as a validation error.
			}
		}
		out.push({ id, name, input });
	}
	return out;
}

function mapFinishReason(reason: string | undefined): StopReason {
	switch (reason) {
		case 'stop':
			return 'end_turn';
		case 'tool_calls':
			return 'tool_use';
		case 'length':
			return 'max_tokens';
		default:
			return 'error';
	}
}

function extractUsage(v: unknown): { inputTokens: number; outputTokens: number } | undefined {
	if (!isRecord(v)) return undefined;
	const input = typeof v.prompt_tokens === 'number' ? v.prompt_tokens : undefined;
	const output = typeof v.completion_tokens === 'number' ? v.completion_tokens : undefined;
	if (input === undefined || output === undefined) return undefined;
	return { inputTokens: input, outputTokens: output };
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
	return typeof v === 'string' ? v : undefined;
}
