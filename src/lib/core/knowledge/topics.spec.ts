import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createDb } from '../db/connection';
import {
	initProjectDb,
	seeds,
	sources,
	workflowRuns,
	agentRuns,
	discoveryReports,
	signals
} from '../db/schema';
import {
	createTopic,
	listTopics,
	getTopic,
	updateTopic,
	deleteTopic,
	deleteTopicCascade
} from './topics';

describe('topic CRUD', () => {
	let db: ReturnType<typeof createDb>;
	let testDir: string;

	// File-backed temp DB rather than :memory: — libsql's in-memory mode
	// doesn't share state across connections, which breaks db.transaction()
	// (used by deleteTopicCascade).
	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), 'bd-topics-'));
		db = createDb(`file:${join(testDir, 'test.db')}`);
		await initProjectDb(db);
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe('createTopic', () => {
		it('creates a topic with generated id and timestamps', async () => {
			const topic = await createTopic(db, { name: 'HCI Research' });
			expect(topic.id).toHaveLength(26);
			expect(topic.name).toBe('HCI Research');
			expect(topic.createdAt).toBeTruthy();
			expect(topic.updatedAt).toBeTruthy();
		});

		it('stores optional fields', async () => {
			const topic = await createTopic(db, {
				name: 'Agent Infra',
				description: 'Research on agent coordination protocols',
				guidance: 'Focus on open-source implementations',
				narrativeThreads: ['MCP ecosystem', 'A2A protocol']
			});
			expect(topic.description).toBe('Research on agent coordination protocols');
			expect(topic.guidance).toBe('Focus on open-source implementations');
			expect(topic.narrativeThreads).toBe(JSON.stringify(['MCP ecosystem', 'A2A protocol']));
		});

		it('defaults optional fields to null', async () => {
			const topic = await createTopic(db, { name: 'Minimal' });
			expect(topic.description).toBeNull();
			expect(topic.guidance).toBeNull();
			expect(topic.narrativeThreads).toBeNull();
		});
	});

	describe('listTopics', () => {
		it('returns all topics', async () => {
			await createTopic(db, { name: 'Topic A' });
			await createTopic(db, { name: 'Topic B' });
			const topics = await listTopics(db);
			expect(topics).toHaveLength(2);
		});

		it('returns empty array when no topics', async () => {
			const topics = await listTopics(db);
			expect(topics).toEqual([]);
		});
	});

	describe('getTopic', () => {
		it('returns topic by id', async () => {
			const created = await createTopic(db, { name: 'Find Me' });
			const found = await getTopic(db, created.id);
			expect(found).not.toBeNull();
			expect(found!.name).toBe('Find Me');
		});

		it('returns null for unknown id', async () => {
			const found = await getTopic(db, 'nonexistent');
			expect(found).toBeNull();
		});
	});

	describe('updateTopic', () => {
		it('updates name', async () => {
			const created = await createTopic(db, { name: 'Old Name' });
			await updateTopic(db, created.id, { name: 'New Name' });
			const found = await getTopic(db, created.id);
			expect(found!.name).toBe('New Name');
		});

		it('updates narrative threads as JSON', async () => {
			const created = await createTopic(db, { name: 'Threads Test' });
			await updateTopic(db, created.id, { narrativeThreads: ['thread-1', 'thread-2'] });
			const found = await getTopic(db, created.id);
			expect(JSON.parse(found!.narrativeThreads!)).toEqual(['thread-1', 'thread-2']);
		});

		it('updates guidance', async () => {
			const created = await createTopic(db, { name: 'Guidance Test' });
			await updateTopic(db, created.id, { guidance: 'Focus on X, ignore Y' });
			const found = await getTopic(db, created.id);
			expect(found!.guidance).toBe('Focus on X, ignore Y');
		});

		it('updates the updatedAt timestamp', async () => {
			const created = await createTopic(db, { name: 'Timestamp Test' });
			await new Promise((r) => setTimeout(r, 10));
			await updateTopic(db, created.id, { name: 'Updated' });
			const found = await getTopic(db, created.id);
			expect(found!.updatedAt).not.toBe(created.updatedAt);
		});
	});

	describe('deleteTopic', () => {
		it('removes the topic', async () => {
			const created = await createTopic(db, { name: 'Doomed' });
			await deleteTopic(db, created.id);
			const found = await getTopic(db, created.id);
			expect(found).toBeNull();
		});
	});

	describe('deleteTopicCascade', () => {
		// Helper to populate every child table with at least one row referencing
		// `topicId`. Returns inserted source IDs so tests can verify removal.
		async function seedAllTables(topicId: string, withRawPath = true) {
			const now = new Date().toISOString();
			const seedId = 'seed-for-' + topicId.slice(-6);
			const sourceId = 'source-for-' + topicId.slice(-6);
			const workflowRunId = 'wfr-for-' + topicId.slice(-6);
			const agentRunId = 'agr-for-' + topicId.slice(-6);
			const reportId = 'rpt-for-' + topicId.slice(-6);
			const signalId = 'sig-for-' + topicId.slice(-6);

			await db.insert(seeds).values({
				id: seedId,
				topicId,
				type: 'briefing_card',
				status: 'ready',
				origin: 'user',
				inputCount: 1,
				processedCount: 1,
				createdAt: now
			});
			await db.insert(sources).values({
				id: sourceId,
				seedId,
				topicId,
				title: 'Source A',
				type: 'file',
				rawPath: withRawPath ? `${sourceId}/original.md` : null,
				content: 'body',
				createdAt: now
			});
			await db.insert(workflowRuns).values({
				id: workflowRunId,
				type: 'add_knowledge',
				topicId,
				status: 'completed',
				startedAt: now
			});
			await db.insert(agentRuns).values({
				id: agentRunId,
				agentType: 'discover',
				topicId,
				workflowRunId,
				status: 'completed',
				startedAt: now
			});
			await db.insert(discoveryReports).values({
				id: reportId,
				topicId,
				workflowRunId,
				status: 'pending',
				createdAt: now
			});
			await db.insert(signals).values({
				id: signalId,
				topicId,
				targetType: 'source',
				targetId: sourceId,
				signalType: 'fresh',
				raisedBy: 'audit',
				status: 'pending',
				createdAt: now
			});

			return { seedId, sourceId, workflowRunId, agentRunId, reportId, signalId };
		}

		it('returns empty removedSourcePaths for a topic with no children', async () => {
			const topic = await createTopic(db, { name: 'Empty' });
			const result = await deleteTopicCascade(db, topic.id);
			expect(result.removedSourcePaths).toEqual([]);
			expect(await getTopic(db, topic.id)).toBeNull();
		});

		it('removes rows across every child table for a fully-populated topic', async () => {
			const topic = await createTopic(db, { name: 'Full' });
			const ids = await seedAllTables(topic.id);

			const result = await deleteTopicCascade(db, topic.id);
			expect(result.removedSourcePaths).toContain(`${ids.sourceId}/original.md`);

			expect(await getTopic(db, topic.id)).toBeNull();
			expect(await db.select().from(seeds)).toEqual([]);
			expect(await db.select().from(sources)).toEqual([]);
			expect(await db.select().from(workflowRuns)).toEqual([]);
			expect(await db.select().from(agentRuns)).toEqual([]);
			expect(await db.select().from(discoveryReports)).toEqual([]);
			expect(await db.select().from(signals)).toEqual([]);
		});

		it('does not touch a sibling topic with its own children', async () => {
			const a = await createTopic(db, { name: 'A' });
			const b = await createTopic(db, { name: 'B' });
			await seedAllTables(a.id);
			await seedAllTables(b.id);

			await deleteTopicCascade(db, a.id);

			// Topic A is gone; topic B is intact with all six children.
			expect(await getTopic(db, a.id)).toBeNull();
			expect(await getTopic(db, b.id)).not.toBeNull();
			expect((await db.select().from(seeds)).length).toBe(1);
			expect((await db.select().from(sources)).length).toBe(1);
			expect((await db.select().from(workflowRuns)).length).toBe(1);
			expect((await db.select().from(agentRuns)).length).toBe(1);
			expect((await db.select().from(discoveryReports)).length).toBe(1);
			expect((await db.select().from(signals)).length).toBe(1);
		});

		it('excludes null raw_paths from removedSourcePaths', async () => {
			const topic = await createTopic(db, { name: 'Mixed' });
			await seedAllTables(topic.id, false); // sources.rawPath = null

			const result = await deleteTopicCascade(db, topic.id);
			expect(result.removedSourcePaths).toEqual([]);
			expect(await db.select().from(sources)).toEqual([]);
		});

		it('handles multiple sources with mixed raw_paths', async () => {
			const topic = await createTopic(db, { name: 'Multi' });
			const now = new Date().toISOString();
			await db.insert(seeds).values({
				id: 'seed-x',
				topicId: topic.id,
				type: 'briefing_card',
				status: 'ready',
				origin: 'user',
				inputCount: 3,
				processedCount: 3,
				createdAt: now
			});
			await db.insert(sources).values([
				{
					id: 's1',
					seedId: 'seed-x',
					topicId: topic.id,
					title: 'with-file',
					type: 'file',
					rawPath: 's1/original.md',
					content: 'a',
					createdAt: now
				},
				{
					id: 's2',
					seedId: 'seed-x',
					topicId: topic.id,
					title: 'text-only',
					type: 'text',
					rawPath: null,
					content: 'b',
					createdAt: now
				},
				{
					id: 's3',
					seedId: 'seed-x',
					topicId: topic.id,
					title: 'with-file-2',
					type: 'file',
					rawPath: 's3/original.txt',
					content: 'c',
					createdAt: now
				}
			]);

			const result = await deleteTopicCascade(db, topic.id);
			expect(result.removedSourcePaths.sort()).toEqual([
				's1/original.md',
				's3/original.txt'
			]);
		});
	});
});
