import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type Database } from '../db/connection';
import { initProjectDb } from '../db/schema';
import {
	createWorkflowRun,
	getWorkflowRun,
	listWorkflowRunsByTopic,
	stageWorkflowRun,
	completeWorkflowRun,
	failWorkflowRun
} from './runs';

describe('workflow_runs lifecycle', () => {
	let db: Database;

	beforeEach(async () => {
		db = createDb(':memory:');
		await initProjectDb(db);
	});

	it('createWorkflowRun starts in running with config round-tripped as JSON', async () => {
		const run = await createWorkflowRun(db, {
			type: 'add_knowledge',
			topicId: 'topic-1',
			config: { channels: { web: { enabled: true } } }
		});
		expect(run.status).toBe('running');
		expect(run.type).toBe('add_knowledge');
		expect(run.config).toEqual({ channels: { web: { enabled: true } } });
		expect(run.startedAt).toBeTruthy();
		expect(run.completedAt).toBeNull();
		expect(run.error).toBeNull();
	});

	it('createWorkflowRun handles a null config', async () => {
		const run = await createWorkflowRun(db, {
			type: 'audit_corpus',
			topicId: 'topic-1',
			config: null
		});
		expect(run.config).toBeNull();
	});

	it('stageWorkflowRun moves running → staged', async () => {
		const run = await createWorkflowRun(db, {
			type: 'add_knowledge',
			topicId: 'topic-1',
			config: null
		});
		const staged = await stageWorkflowRun(db, run.id);
		expect(staged.status).toBe('staged');
	});

	it('stageWorkflowRun rejects non-running transitions', async () => {
		const run = await createWorkflowRun(db, {
			type: 'add_knowledge',
			topicId: 'topic-1',
			config: null
		});
		await stageWorkflowRun(db, run.id);
		await expect(stageWorkflowRun(db, run.id)).rejects.toThrow(/running/);
	});

	it('completeWorkflowRun moves staged → completed and stamps completedAt', async () => {
		const run = await createWorkflowRun(db, {
			type: 'add_knowledge',
			topicId: 'topic-1',
			config: null
		});
		await stageWorkflowRun(db, run.id);
		const completed = await completeWorkflowRun(db, run.id);
		expect(completed.status).toBe('completed');
		expect(completed.completedAt).toBeTruthy();
	});

	it('completeWorkflowRun allows running → completed directly (prune, no stage gate)', async () => {
		const run = await createWorkflowRun(db, {
			type: 'prune_corpus',
			topicId: 'topic-1',
			config: null
		});
		const completed = await completeWorkflowRun(db, run.id);
		expect(completed.status).toBe('completed');
	});

	it('completeWorkflowRun rejects transitions from terminal states', async () => {
		const run = await createWorkflowRun(db, {
			type: 'prune_corpus',
			topicId: 'topic-1',
			config: null
		});
		await completeWorkflowRun(db, run.id);
		await expect(completeWorkflowRun(db, run.id)).rejects.toThrow();
	});

	it('failWorkflowRun moves any non-terminal → failed with error stored', async () => {
		const run = await createWorkflowRun(db, {
			type: 'add_knowledge',
			topicId: 'topic-1',
			config: null
		});
		const failed = await failWorkflowRun(db, run.id, 'discover LLM timed out');
		expect(failed.status).toBe('failed');
		expect(failed.error).toBe('discover LLM timed out');
		expect(failed.completedAt).toBeTruthy();
	});

	it('failWorkflowRun rejects transitions from terminal states', async () => {
		const run = await createWorkflowRun(db, {
			type: 'add_knowledge',
			topicId: 'topic-1',
			config: null
		});
		await failWorkflowRun(db, run.id, 'boom');
		await expect(failWorkflowRun(db, run.id, 'again')).rejects.toThrow();
	});

	it('listWorkflowRunsByTopic filters by topic', async () => {
		await createWorkflowRun(db, { type: 'add_knowledge', topicId: 'a', config: null });
		await createWorkflowRun(db, { type: 'audit_corpus', topicId: 'a', config: null });
		await createWorkflowRun(db, { type: 'add_knowledge', topicId: 'b', config: null });
		const runs = await listWorkflowRunsByTopic(db, 'a');
		expect(runs).toHaveLength(2);
	});

	it('getWorkflowRun returns null for unknown id', async () => {
		expect(await getWorkflowRun(db, 'does-not-exist')).toBeNull();
	});
});
