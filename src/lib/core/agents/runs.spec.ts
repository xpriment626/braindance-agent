import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../db/connection';
import { initProjectDb } from '../db/schema';
import { createTopic } from '../knowledge/topics';
import {
	createAgentRun,
	getAgentRun,
	completeAgentRun,
	failAgentRun,
	listAgentRunsByTopic
} from './runs';

describe('agent runs', () => {
	let db: ReturnType<typeof createDb>;
	let topicId: string;

	beforeEach(async () => {
		db = createDb(':memory:');
		await initProjectDb(db);
		const topic = await createTopic(db, { name: 'Test Topic' });
		topicId = topic.id;
	});

	describe('createAgentRun', () => {
		it('creates a run with running status and startedAt', async () => {
			const run = await createAgentRun(db, {
				agentType: 'discover',
				topicId,
				config: { model: 'moonshotai/kimi-k2.6' }
			});
			expect(run.id).toHaveLength(26);
			expect(run.status).toBe('running');
			expect(run.startedAt).toBeTruthy();
			expect(run.completedAt).toBeNull();
			expect(run.error).toBeNull();
			expect(JSON.parse(run.config!)).toEqual({ model: 'moonshotai/kimi-k2.6' });
		});

		it('stores workflowRunId when provided', async () => {
			const run = await createAgentRun(db, {
				agentType: 'audit',
				topicId,
				workflowRunId: 'wf-123'
			});
			expect(run.workflowRunId).toBe('wf-123');
		});

		it('defaults workflowRunId and config to null', async () => {
			const run = await createAgentRun(db, {
				agentType: 'writer',
				topicId
			});
			expect(run.workflowRunId).toBeNull();
			expect(run.config).toBeNull();
		});
	});

	describe('getAgentRun', () => {
		it('returns run by id', async () => {
			const created = await createAgentRun(db, { agentType: 'discover', topicId });
			const found = await getAgentRun(db, created.id);
			expect(found!.id).toBe(created.id);
		});

		it('returns null for unknown id', async () => {
			const found = await getAgentRun(db, 'nonexistent');
			expect(found).toBeNull();
		});
	});

	describe('completeAgentRun', () => {
		it('sets status to completed and stamps completedAt', async () => {
			const created = await createAgentRun(db, { agentType: 'strategy', topicId });
			await completeAgentRun(db, created.id);
			const found = await getAgentRun(db, created.id);
			expect(found!.status).toBe('completed');
			expect(found!.completedAt).toBeTruthy();
			expect(found!.error).toBeNull();
		});
	});

	describe('failAgentRun', () => {
		it('sets status to failed with error message and completedAt', async () => {
			const created = await createAgentRun(db, { agentType: 'discover', topicId });
			await failAgentRun(db, created.id, 'LLM returned malformed JSON');
			const found = await getAgentRun(db, created.id);
			expect(found!.status).toBe('failed');
			expect(found!.error).toBe('LLM returned malformed JSON');
			expect(found!.completedAt).toBeTruthy();
		});
	});

	describe('listAgentRunsByTopic', () => {
		it('returns runs for a topic', async () => {
			await createAgentRun(db, { agentType: 'discover', topicId });
			await createAgentRun(db, { agentType: 'audit', topicId });
			const runs = await listAgentRunsByTopic(db, topicId);
			expect(runs).toHaveLength(2);
		});

		it('returns empty array when no runs for topic', async () => {
			const runs = await listAgentRunsByTopic(db, 'no-such-topic');
			expect(runs).toEqual([]);
		});
	});
});
