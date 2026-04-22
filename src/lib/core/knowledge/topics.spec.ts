import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../db/connection';
import { initProjectDb } from '../db/schema';
import { createTopic, listTopics, getTopic, updateTopic, deleteTopic } from './topics';

describe('topic CRUD', () => {
	let db: ReturnType<typeof createDb>;

	beforeEach(async () => {
		db = createDb(':memory:');
		await initProjectDb(db);
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
});
