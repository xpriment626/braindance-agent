import { describe, it, expect } from 'vitest';
import { createMockProvider, toolCallResponse, textResponse } from './llm';
import { runPrune, type PruneMutationTools, type PruneInput } from './prune';
import type { Signal } from '../knowledge/signals';

function makeMutationSpy(): PruneMutationTools & {
	deleted: string[];
	consolidated: Array<{ canonicalId: string; supersededIds: string[] }>;
} {
	const deleted: string[] = [];
	const consolidated: Array<{ canonicalId: string; supersededIds: string[] }> = [];
	return {
		deleted,
		consolidated,
		async deleteSource(id) {
			deleted.push(id);
		},
		async markConsolidated(canonicalId, supersededIds) {
			consolidated.push({ canonicalId, supersededIds });
		}
	};
}

const baseTopic: PruneInput['topic'] = {
	id: 'topic-1',
	name: 'Agent Protocols',
	description: null,
	guidance: null,
	narrativeThreads: null
};

function staleSignal(id: string, targetId: string): Signal {
	return {
		id,
		topicId: 'topic-1',
		targetType: 'source',
		targetId,
		signalType: 'stale',
		reason: 'old',
		raisedBy: 'audit',
		status: 'approved',
		metadata: null,
		createdAt: '2026-04-24T00:00:00Z',
		resolvedAt: '2026-04-24T01:00:00Z'
	};
}

function consolidationSignal(id: string, canonicalId: string, supersededIds: string[]): Signal {
	return {
		id,
		topicId: 'topic-1',
		targetType: 'source',
		targetId: canonicalId,
		signalType: 'consolidation',
		reason: 'duplicates',
		raisedBy: 'audit',
		status: 'approved',
		metadata: { canonicalId, supersededIds },
		createdAt: '2026-04-24T00:00:00Z',
		resolvedAt: '2026-04-24T01:00:00Z'
	};
}

describe('runPrune', () => {
	it('applies delete_source mutations for approved stale signals and records them', async () => {
		const signals = [staleSignal('sig-1', 'src-1'), staleSignal('sig-2', 'src-2')];
		const mutations = makeMutationSpy();
		const provider = createMockProvider(
			toolCallResponse([
				{ id: 'call-1', name: 'delete_source', input: { source_id: 'src-1', reason: 'stale' } },
				{ id: 'call-2', name: 'delete_source', input: { source_id: 'src-2', reason: 'stale' } }
			]),
			toolCallResponse([
				{ id: 'call-f', name: 'submit_prune_log', input: { summary: 'deleted 2 stale sources' } }
			])
		);
		const output = await runPrune(
			provider,
			mutations,
			{ topic: baseTopic, approvedSignals: signals }
		);
		expect(mutations.deleted).toEqual(['src-1', 'src-2']);
		expect(output.appliedMutations).toHaveLength(2);
		expect(output.appliedMutations.map((m) => m.signalId).sort()).toEqual(['sig-1', 'sig-2']);
		expect(output.appliedMutations[0].action).toBe('delete_source');
		expect(output.summary).toContain('deleted 2 stale sources');
	});

	it('applies mark_consolidated for a consolidation signal', async () => {
		const signals = [consolidationSignal('sig-c', 'src-canonical', ['src-dup-1', 'src-dup-2'])];
		const mutations = makeMutationSpy();
		const provider = createMockProvider(
			toolCallResponse([
				{
					id: 'call-1',
					name: 'mark_consolidated',
					input: {
						canonical_source_id: 'src-canonical',
						superseded_source_ids: ['src-dup-1', 'src-dup-2'],
						reason: 'duplicates'
					}
				}
			]),
			toolCallResponse([
				{ id: 'call-f', name: 'submit_prune_log', input: { summary: 'consolidated duplicates' } }
			])
		);
		const output = await runPrune(
			provider,
			mutations,
			{ topic: baseTopic, approvedSignals: signals }
		);
		expect(mutations.consolidated).toHaveLength(1);
		expect(mutations.consolidated[0].canonicalId).toBe('src-canonical');
		expect(output.appliedMutations[0].signalId).toBe('sig-c');
		expect(output.appliedMutations[0].action).toBe('mark_consolidated');
	});

	it('rejects mutations referencing a source not in any approved signal', async () => {
		const signals = [staleSignal('sig-1', 'src-1')];
		const mutations = makeMutationSpy();
		const provider = createMockProvider(
			toolCallResponse([
				{
					id: 'call-rogue',
					name: 'delete_source',
					input: { source_id: 'src-unauthorized', reason: 'whim' }
				}
			]),
			toolCallResponse([
				{ id: 'call-retry', name: 'delete_source', input: { source_id: 'src-1', reason: 'stale' } }
			]),
			toolCallResponse([
				{ id: 'call-f', name: 'submit_prune_log', input: { summary: 'done' } }
			])
		);
		const output = await runPrune(
			provider,
			mutations,
			{ topic: baseTopic, approvedSignals: signals }
		);
		// The rogue mutation must not have executed; only the authorized one did.
		expect(mutations.deleted).toEqual(['src-1']);
		expect(output.appliedMutations).toHaveLength(1);
		expect(output.appliedMutations[0].signalId).toBe('sig-1');
	});

	it('returns an empty log when the LLM calls submit_prune_log with no mutations', async () => {
		const mutations = makeMutationSpy();
		const provider = createMockProvider(
			toolCallResponse([
				{ id: 'call-f', name: 'submit_prune_log', input: { summary: 'nothing actionable' } }
			])
		);
		const output = await runPrune(
			provider,
			mutations,
			{ topic: baseTopic, approvedSignals: [] }
		);
		expect(output.appliedMutations).toEqual([]);
		expect(mutations.deleted).toEqual([]);
	});

	it('throws when the LLM returns prose without calling any tool within maxIterations', async () => {
		const mutations = makeMutationSpy();
		const provider = createMockProvider(textResponse("I won't do this."));
		await expect(
			runPrune(
				provider,
				mutations,
				{ topic: baseTopic, approvedSignals: [staleSignal('sig-1', 'src-1')] },
				{ maxIterations: 2 }
			)
		).rejects.toThrow(/submit_prune_log/);
	});
});
