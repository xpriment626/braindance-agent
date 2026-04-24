import type { LLMProvider, ChatMessage, ToolDef, ToolCall } from './llm';
import type { AuditInput, AuditOutput, AuditSignal, GapAnalysis, ConsolidationSuggestion } from './types';

export interface RunAuditOptions {
	model?: string;
	maxIterations?: number;
}

const DEFAULT_MODEL = 'moonshotai/kimi-k2.6';
const DEFAULT_MAX_ITERATIONS = 5;

const AUDIT_SYSTEM_PROMPT = `You are a corpus quality analyst. Given a topic and its current corpus, produce structured findings along four axes:

1. Freshness — sources that are stale, retracted, or notably up-to-date.
2. Contradictions — sources that conflict on substantive claims.
3. Gap analysis — narrative threads whose coverage is strong, thin, or missing.
4. Consolidation — groups of sources that should be merged (e.g. duplicates, one supersedes another).

Every finding must include a human-legible reason — show your work so the user can approve or dismiss each signal with full context. When finished, call submit_audit exactly once with the structured findings. Do not respond with prose — only tool calls.`;

const SUBMIT_AUDIT_TOOL: ToolDef = {
	name: 'submit_audit',
	description:
		'Submit the final audit findings and terminate. Call exactly once when done analyzing.',
	inputSchema: {
		type: 'object',
		properties: {
			freshnessFlags: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						targetId: { type: 'string' },
						signalType: {
							type: 'string',
							enum: ['fresh', 'contested', 'stale', 'retracted']
						},
						reason: { type: 'string' }
					},
					required: ['targetId', 'signalType', 'reason']
				}
			},
			contradictions: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						targetId: { type: 'string' },
						signalType: {
							type: 'string',
							enum: ['fresh', 'contested', 'stale', 'retracted']
						},
						reason: { type: 'string' }
					},
					required: ['targetId', 'signalType', 'reason']
				}
			},
			gapAnalysis: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						thread: { type: 'string' },
						coverage: { type: 'string', enum: ['strong', 'thin', 'missing'] },
						notes: { type: 'string' }
					},
					required: ['thread', 'coverage', 'notes']
				}
			},
			consolidationSuggestions: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						sourceIds: { type: 'array', items: { type: 'string' } },
						reason: { type: 'string' }
					},
					required: ['sourceIds', 'reason']
				}
			},
			summary: { type: 'string' }
		},
		required: [
			'freshnessFlags',
			'contradictions',
			'gapAnalysis',
			'consolidationSuggestions',
			'summary'
		]
	}
};

export async function runAudit(
	llm: LLMProvider,
	input: AuditInput,
	options: RunAuditOptions = {}
): Promise<AuditOutput> {
	const model = options.model ?? DEFAULT_MODEL;
	const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

	const messages: ChatMessage[] = [
		{ role: 'user', content: buildUserPrompt(input) }
	];

	for (let iteration = 0; iteration < maxIterations; iteration++) {
		const result = await llm.generate({
			model,
			system: AUDIT_SYSTEM_PROMPT,
			messages,
			tools: [SUBMIT_AUDIT_TOOL]
		});

		const submitCall = result.toolCalls.find((c) => c.name === 'submit_audit');
		if (submitCall) {
			return parseAuditOutput(submitCall);
		}

		messages.push({
			role: 'assistant',
			content: result.text,
			toolCalls: result.toolCalls
		});

		if (result.toolCalls.length === 0) {
			messages.push({
				role: 'user',
				content:
					'Respond by calling submit_audit with the structured findings. Do not respond with prose.'
			});
			continue;
		}

		for (const call of result.toolCalls) {
			messages.push({
				role: 'tool',
				toolCallId: call.id,
				content: JSON.stringify({
					error: `unknown tool: ${call.name}. Only submit_audit is available — call that to finish.`
				})
			});
		}
	}

	throw new Error(
		`Audit agent exceeded maxIterations (${maxIterations}) without calling submit_audit`
	);
}

// ─── Prompt construction ──────────────────────────────────

function buildUserPrompt(input: AuditInput): string {
	const threads = input.topic.narrativeThreads?.join(', ') ?? 'None defined';
	const corpusSection =
		input.corpus.length === 0
			? '(empty corpus)'
			: input.corpus.map(formatCorpusEntry).join('\n\n');
	return `Topic: ${input.topic.name}
Description: ${input.topic.description ?? 'N/A'}
Research guidance: ${input.topic.guidance ?? 'N/A'}
Narrative threads: ${threads}

Corpus:
${corpusSection}

Analyze and submit findings via submit_audit.`;
}

function formatCorpusEntry(source: AuditInput['corpus'][number]): string {
	const content = source.content ?? '(no content)';
	const trimmed = content.length > 1200 ? `${content.slice(0, 1200)}…` : content;
	return `### ${source.title} (${source.id})
type=${source.type} createdAt=${source.createdAt}
${source.originalUrl ? `url=${source.originalUrl}\n` : ''}${trimmed}`;
}

// ─── Output parsing ───────────────────────────────────────

function parseAuditOutput(call: ToolCall): AuditOutput {
	const input = call.input;
	return {
		freshnessFlags: parseAuditSignals(input.freshnessFlags),
		contradictions: parseAuditSignals(input.contradictions),
		gapAnalysis: parseGapAnalysis(input.gapAnalysis),
		consolidationSuggestions: parseConsolidationSuggestions(input.consolidationSuggestions),
		summary: asString(input.summary) ?? ''
	};
}

function parseAuditSignals(raw: unknown): AuditSignal[] {
	if (!Array.isArray(raw)) return [];
	const out: AuditSignal[] = [];
	for (const item of raw) {
		if (!isRecord(item)) continue;
		const targetId = asString(item.targetId);
		const signalType = asString(item.signalType);
		const reason = asString(item.reason);
		if (!targetId || !reason) continue;
		if (
			signalType !== 'fresh' &&
			signalType !== 'contested' &&
			signalType !== 'stale' &&
			signalType !== 'retracted'
		) {
			continue;
		}
		out.push({ targetId, signalType, reason });
	}
	return out;
}

function parseGapAnalysis(raw: unknown): GapAnalysis[] {
	if (!Array.isArray(raw)) return [];
	const out: GapAnalysis[] = [];
	for (const item of raw) {
		if (!isRecord(item)) continue;
		const thread = asString(item.thread);
		const coverage = asString(item.coverage);
		const notes = asString(item.notes);
		if (!thread || !notes) continue;
		if (coverage !== 'strong' && coverage !== 'thin' && coverage !== 'missing') continue;
		out.push({ thread, coverage, notes });
	}
	return out;
}

function parseConsolidationSuggestions(raw: unknown): ConsolidationSuggestion[] {
	if (!Array.isArray(raw)) return [];
	const out: ConsolidationSuggestion[] = [];
	for (const item of raw) {
		if (!isRecord(item)) continue;
		const sourceIds = asStringArray(item.sourceIds);
		const reason = asString(item.reason);
		if (sourceIds.length === 0 || !reason) continue;
		out.push({ sourceIds, reason });
	}
	return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
	return typeof v === 'string' ? v : undefined;
}

function asStringArray(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v.filter((x): x is string => typeof x === 'string');
}
