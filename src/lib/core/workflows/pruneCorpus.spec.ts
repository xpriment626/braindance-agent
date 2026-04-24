import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type Database } from '../db/connection';
import { initProjectDb, workflowRuns } from '../db/schema';
import { createTopic } from '../knowledge/topics';
import { createSeed } from '../knowledge/seeds';
import { createSource, getSource } from '../knowledge/sources';
import { generateId } from '../db/id';
import { createSignal, approveSignal, getSignal } from '../knowledge/signals';
import { createMockProvider, toolCallResponse, type LLMProvider } from '../agents/llm';
import { pruneCorpus } from './pruneCorpus';
import { getWorkflowRun } from './runs';

async function seedSource(db: Database, topicId: string, title: string): Promise<string> {
	const seed = await createSeed(db, {
		topicId,
		type: 'freeform',
		origin: 'user',
		inputCount: 1
	});
	const id = generateId();
	await createSource(db, {
		id,
		seedId: seed.id,
		topicId,
		title,
		type: 'text',
		content: 'c',
		originalFormat: 'text/plain'
	});
	return id;
}

describe('pruneCorpus workflow', () => {
	let db: Database;
	let topicId: string;

	beforeEach(async () => {
		db = createDb(':memory:');
		await initProjectDb(db);
		const topic = await createTopic(db, { name: 'T' });
		topicId = topic.id;
	});

	it('applies approved stale signals by deleting their target sources and advances signal status to applied', async () => {
		const sourceId = await seedSource(db, topicId, 'to-delete');
		const pending = await createSignal(db, {
			topicId,
			targetType: 'source',
			targetId: sourceId,
			signalType: 'stale',
			reason: 'old',
			raisedBy: 'audit'
		});
		const approved = await approveSignal(db, pending.id);

		const llm: LLMProvider = createMockProvider(
			toolCallResponse([
				{
					id: 'c1',
					name: 'delete_source',
					input: { source_id: sourceId, reason: 'stale' }
				}
			]),
			toolCallResponse([
				{ id: 'cf', name: 'submit_prune_log', input: { summary: 'done' } }
			])
		);

		const { workflowRunId, log } = await pruneCorpus(
			db,
			topicId,
			[approved.id],
			{ llm, config: {} }
		);

		const run = await getWorkflowRun(db, workflowRunId);
		expect(run?.status).toBe('completed');

		expect(await getSource(db, sourceId)).toBeNull();

		const signal = await getSignal(db, approved.id);
		expect(signal?.status).toBe('applied');

		expect(log.appliedMutations).toHaveLength(1);
	});

	it('rejects approvedSignalIds that do not resolve to approved signals for this topic', async () => {
		const otherTopic = await createTopic(db, { name: 'other' });
		const foreign = await createSignal(db, {
			topicId: otherTopic.id,
			targetType: 'source',
			targetId: 'src-x',
			signalType: 'stale',
			raisedBy: 'audit'
		});
		await approveSignal(db, foreign.id);
		await expect(
			pruneCorpus(db, topicId, [foreign.id], {
				llm: createMockProvider(
					toolCallResponse([{ id: 'f', name: 'submit_prune_log', input: { summary: '' } }])
				),
				config: {}
			})
		).rejects.toThrow(/topic/);
	});

	it('rejects when a signal id does not exist', async () => {
		await expect(
			pruneCorpus(db, topicId, ['nope'], {
				llm: createMockProvider(
					toolCallResponse([{ id: 'f', name: 'submit_prune_log', input: { summary: '' } }])
				),
				config: {}
			})
		).rejects.toThrow(/not found/);
	});

	it('rejects when a signal is not in approved status', async () => {
		const sourceId = await seedSource(db, topicId, 's');
		const pending = await createSignal(db, {
			topicId,
			targetType: 'source',
			targetId: sourceId,
			signalType: 'stale',
			raisedBy: 'audit'
		});
		await expect(
			pruneCorpus(db, topicId, [pending.id], {
				llm: createMockProvider(
					toolCallResponse([{ id: 'f', name: 'submit_prune_log', input: { summary: '' } }])
				),
				config: {}
			})
		).rejects.toThrow(/approved/);
	});

	it('fails the workflow when the prune agent throws', async () => {
		const sourceId = await seedSource(db, topicId, 's');
		const sig = await createSignal(db, {
			topicId,
			targetType: 'source',
			targetId: sourceId,
			signalType: 'stale',
			raisedBy: 'audit'
		});
		await approveSignal(db, sig.id);
		const failingLLM: LLMProvider = {
			async generate() {
				throw new Error('llm boom');
			}
		};
		await expect(
			pruneCorpus(db, topicId, [sig.id], { llm: failingLLM, config: {} })
		).rejects.toThrow(/llm boom/);
		const runs = await db.select().from(workflowRuns);
		expect(runs[0].status).toBe('failed');
	});
});
