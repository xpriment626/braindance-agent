import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../db/connection';
import { initProjectDb } from '../db/schema';
import { createTopic } from './topics';
import { createSeed } from './seeds';
import { createSource, getSource, listSourcesByTopic, listSourcesBySeed } from './sources';

describe('source CRUD', () => {
	let db: ReturnType<typeof createDb>;
	let topicId: string;
	let seedId: string;

	beforeEach(async () => {
		db = createDb(':memory:');
		await initProjectDb(db);
		const topic = await createTopic(db, { name: 'Test Topic' });
		topicId = topic.id;
		const seed = await createSeed(db, {
			topicId,
			type: 'freeform',
			origin: 'user',
			inputCount: 1
		});
		seedId = seed.id;
	});

	describe('createSource', () => {
		it('creates a source with all fields', async () => {
			const source = await createSource(db, {
				id: 'source-001',
				seedId,
				topicId,
				title: 'Test Article',
				type: 'url',
				content: 'Article body',
				originalUrl: 'https://example.com',
				originalFormat: 'text/html',
				provenance: 'Scraped from example.com',
				metadata: { author: 'John' }
			});
			expect(source.id).toBe('source-001');
			expect(source.title).toBe('Test Article');
			expect(source.type).toBe('url');
			expect(JSON.parse(source.metadata!)).toEqual({ author: 'John' });
		});

		it('defaults optional fields to null', async () => {
			const source = await createSource(db, {
				id: 'source-002',
				seedId,
				topicId,
				title: 'Plain Text',
				type: 'text',
				content: 'Just some text',
				originalFormat: 'text/plain'
			});
			expect(source.originalUrl).toBeNull();
			expect(source.rawPath).toBeNull();
			expect(source.metadata).toBeNull();
		});
	});

	describe('getSource', () => {
		it('returns source by id', async () => {
			await createSource(db, {
				id: 'source-003',
				seedId,
				topicId,
				title: 'Find Me',
				type: 'text',
				content: 'x',
				originalFormat: 'text/plain'
			});
			const found = await getSource(db, 'source-003');
			expect(found!.title).toBe('Find Me');
		});

		it('returns null for unknown id', async () => {
			const found = await getSource(db, 'nonexistent');
			expect(found).toBeNull();
		});
	});

	describe('listSourcesByTopic', () => {
		it('returns sources for a topic', async () => {
			await createSource(db, {
				id: 'source-a',
				seedId,
				topicId,
				title: 'A',
				type: 'text',
				content: 'x',
				originalFormat: 'text/plain'
			});
			await createSource(db, {
				id: 'source-b',
				seedId,
				topicId,
				title: 'B',
				type: 'url',
				content: 'y',
				originalFormat: 'text/html'
			});
			const sources = await listSourcesByTopic(db, topicId);
			expect(sources).toHaveLength(2);
		});
	});

	describe('listSourcesBySeed', () => {
		it('returns sources for a specific seed', async () => {
			await createSource(db, {
				id: 'source-c',
				seedId,
				topicId,
				title: 'C',
				type: 'text',
				content: 'x',
				originalFormat: 'text/plain'
			});
			const sources = await listSourcesBySeed(db, seedId);
			expect(sources).toHaveLength(1);
			expect(sources[0].title).toBe('C');
		});
	});
});
