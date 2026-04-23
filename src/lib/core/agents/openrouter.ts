import type {
	ChatMessage,
	GenerateParams,
	GenerateResult,
	LLMProvider,
	StopReason,
	ToolCall,
	ToolDef
} from './llm';

export interface OpenRouterOptions {
	apiKey: string;
	baseUrl?: string;
	// Injectable for testing; defaults to global fetch.
	fetch?: typeof fetch;
	// Sent as OpenRouter attribution headers (optional but encouraged).
	appName?: string;
	appUrl?: string;
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

export function createOpenRouterProvider(opts: OpenRouterOptions): LLMProvider {
	const fetchImpl = opts.fetch ?? fetch;
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

			const response = await fetchImpl(`${baseUrl}/chat/completions`, {
				method: 'POST',
				headers,
				body: JSON.stringify(body)
			});

			if (!response.ok) {
				const text = await response.text();
				throw new Error(
					`OpenRouter request failed: ${response.status} ${response.statusText} — ${text.slice(0, 200)}`
				);
			}

			const payload: unknown = await response.json();
			return parseResponse(payload);
		}
	};
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
		throw new Error('OpenRouter response was not a JSON object');
	}
	const choices = payload.choices;
	if (!Array.isArray(choices) || choices.length === 0) {
		throw new Error('OpenRouter response had no choices');
	}
	const choice = choices[0];
	if (!isRecord(choice)) {
		throw new Error('OpenRouter response choice was not an object');
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
