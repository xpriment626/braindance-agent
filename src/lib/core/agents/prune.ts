import type { LLMProvider, ChatMessage, ToolDef, ToolCall } from './llm';
import type { TopicContext } from './types';
import type { Signal } from '../knowledge/signals';

export interface PruneInput {
	topic: TopicContext;
	approvedSignals: Signal[];
}

export interface AppliedMutation {
	signalId: string;
	action: 'delete_source' | 'mark_consolidated';
	details: Record<string, unknown>;
}

export interface PruneOutput {
	appliedMutations: AppliedMutation[];
	summary: string;
}

export interface PruneMutationTools {
	deleteSource(id: string): Promise<void>;
	markConsolidated(canonicalId: string, supersededIds: string[]): Promise<void>;
}

export interface RunPruneOptions {
	model?: string;
	maxIterations?: number;
}

const DEFAULT_MODEL = 'moonshotai/kimi-k2.6';
const DEFAULT_MAX_ITERATIONS = 10;

const PRUNE_SYSTEM_PROMPT = `You are a corpus pruning agent. You apply a pre-approved set of audit signals against the knowledge base using the mutation tools provided.

Rules:
- You can only mutate sources referenced by the approved signals listed in the user turn.
- Attempting to mutate any other source will be rejected.
- For stale/retracted signals, call delete_source with the source_id from the signal.
- For consolidation signals, call mark_consolidated with the canonical_source_id and the superseded_source_ids (from the signal's metadata).
- When you have applied every authorized mutation, call submit_prune_log with a summary. Call it exactly once at the end.

Do not respond with prose — only tool calls.`;

const TOOLS: ToolDef[] = [
	{
		name: 'delete_source',
		description:
			'Delete a source from the corpus. Only valid for sources referenced by an approved stale or retracted signal.',
		inputSchema: {
			type: 'object',
			properties: {
				source_id: { type: 'string' },
				reason: { type: 'string' }
			},
			required: ['source_id', 'reason']
		}
	},
	{
		name: 'mark_consolidated',
		description:
			'Mark one or more sources as superseded by a canonical source. Only valid for sources referenced by an approved consolidation signal.',
		inputSchema: {
			type: 'object',
			properties: {
				canonical_source_id: { type: 'string' },
				superseded_source_ids: { type: 'array', items: { type: 'string' } },
				reason: { type: 'string' }
			},
			required: ['canonical_source_id', 'superseded_source_ids', 'reason']
		}
	},
	{
		name: 'submit_prune_log',
		description:
			'Finalize the prune run and return a summary. Call this exactly once when done.',
		inputSchema: {
			type: 'object',
			properties: {
				summary: { type: 'string' }
			},
			required: ['summary']
		}
	}
];

export async function runPrune(
	llm: LLMProvider,
	mutations: PruneMutationTools,
	input: PruneInput,
	options: RunPruneOptions = {}
): Promise<PruneOutput> {
	const model = options.model ?? DEFAULT_MODEL;
	const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

	const applied: AppliedMutation[] = [];
	const usedSignalIds = new Set<string>();

	const messages: ChatMessage[] = [
		{ role: 'user', content: buildUserPrompt(input) }
	];

	for (let iteration = 0; iteration < maxIterations; iteration++) {
		const result = await llm.generate({
			model,
			system: PRUNE_SYSTEM_PROMPT,
			messages,
			tools: TOOLS
		});

		const finishCall = result.toolCalls.find((c) => c.name === 'submit_prune_log');
		if (finishCall) {
			return {
				appliedMutations: applied,
				summary: asString(finishCall.input.summary) ?? ''
			};
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
					'Respond by calling a mutation tool or submit_prune_log. Do not respond with prose.'
			});
			continue;
		}

		for (const call of result.toolCalls) {
			const feedback = await dispatchMutation(
				call,
				input.approvedSignals,
				usedSignalIds,
				mutations,
				applied
			);
			messages.push({
				role: 'tool',
				toolCallId: call.id,
				content: JSON.stringify(feedback)
			});
		}
	}

	throw new Error(
		`Prune agent exceeded maxIterations (${maxIterations}) without calling submit_prune_log`
	);
}

// ─── Mutation dispatch ────────────────────────────────────

async function dispatchMutation(
	call: ToolCall,
	approvedSignals: Signal[],
	usedSignalIds: Set<string>,
	mutations: PruneMutationTools,
	applied: AppliedMutation[]
): Promise<unknown> {
	if (call.name === 'delete_source') {
		const sourceId = asString(call.input.source_id);
		if (!sourceId) return { error: 'delete_source requires source_id' };
		const signal = findSignalForSourceDeletion(sourceId, approvedSignals, usedSignalIds);
		if (!signal) {
			return {
				error: `source_id "${sourceId}" is not referenced by any unused approved delete/retract signal`
			};
		}
		try {
			await mutations.deleteSource(sourceId);
			usedSignalIds.add(signal.id);
			applied.push({
				signalId: signal.id,
				action: 'delete_source',
				details: { sourceId, reason: asString(call.input.reason) ?? '' }
			});
			return { ok: true, signalId: signal.id };
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
	}

	if (call.name === 'mark_consolidated') {
		const canonicalId = asString(call.input.canonical_source_id);
		const supersededIds = asStringArray(call.input.superseded_source_ids);
		if (!canonicalId || supersededIds.length === 0) {
			return { error: 'mark_consolidated requires canonical_source_id and non-empty superseded_source_ids' };
		}
		const signal = findConsolidationSignal(
			canonicalId,
			supersededIds,
			approvedSignals,
			usedSignalIds
		);
		if (!signal) {
			return {
				error: `canonical/superseded ids do not match any unused approved consolidation signal`
			};
		}
		try {
			await mutations.markConsolidated(canonicalId, supersededIds);
			usedSignalIds.add(signal.id);
			applied.push({
				signalId: signal.id,
				action: 'mark_consolidated',
				details: {
					canonicalId,
					supersededIds,
					reason: asString(call.input.reason) ?? ''
				}
			});
			return { ok: true, signalId: signal.id };
		} catch (error) {
			return { error: error instanceof Error ? error.message : String(error) };
		}
	}

	return { error: `unknown tool: ${call.name}` };
}

function findSignalForSourceDeletion(
	sourceId: string,
	approvedSignals: Signal[],
	usedSignalIds: Set<string>
): Signal | null {
	return (
		approvedSignals.find(
			(s) =>
				!usedSignalIds.has(s.id) &&
				s.targetType === 'source' &&
				s.targetId === sourceId &&
				(s.signalType === 'stale' || s.signalType === 'retracted')
		) ?? null
	);
}

function findConsolidationSignal(
	canonicalId: string,
	supersededIds: string[],
	approvedSignals: Signal[],
	usedSignalIds: Set<string>
): Signal | null {
	for (const s of approvedSignals) {
		if (usedSignalIds.has(s.id)) continue;
		if (s.signalType !== 'consolidation') continue;
		const meta = s.metadata ?? {};
		const metaCanonical = asString(meta.canonicalId);
		const metaSuperseded = asStringArray(meta.supersededIds);
		if (metaCanonical !== canonicalId) continue;
		if (!isSubsetOf(supersededIds, metaSuperseded)) continue;
		return s;
	}
	return null;
}

function isSubsetOf(subset: string[], superset: string[]): boolean {
	const set = new Set(superset);
	return subset.every((x) => set.has(x));
}

// ─── Prompt construction ──────────────────────────────────

function buildUserPrompt(input: PruneInput): string {
	if (input.approvedSignals.length === 0) {
		return `Topic: ${input.topic.name}

No approved signals to apply. Call submit_prune_log with an empty summary to finish.`;
	}
	const signalLines = input.approvedSignals.map(formatSignal).join('\n');
	return `Topic: ${input.topic.name}

Approved signals to apply:
${signalLines}

Apply each signal using the appropriate mutation tool, then call submit_prune_log.`;
}

function formatSignal(s: Signal): string {
	const meta = s.metadata ? ` metadata=${JSON.stringify(s.metadata)}` : '';
	return `- id=${s.id} type=${s.signalType} target=${s.targetType}/${s.targetId} reason=${s.reason ?? ''}${meta}`;
}

// ─── Helpers ──────────────────────────────────────────────

function asString(v: unknown): string | undefined {
	return typeof v === 'string' ? v : undefined;
}

function asStringArray(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v.filter((x): x is string => typeof x === 'string');
}
