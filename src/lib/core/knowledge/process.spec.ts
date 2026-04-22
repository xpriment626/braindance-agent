import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../db/connection';
import { initProjectDb } from '../db/schema';
import { createTopic, getTopic } from './topics';
import { getSeed } from './seeds';
import { listSourcesByTopic } from './sources';
import { processSeed, processBriefingCard } from './process';
import type { UrlScraper } from './handlers/types';

describe('processSeed', () => {
	let db: ReturnType<typeof createDb>;
	let topicId: string;

	const mockScraper: UrlScraper = {
		scrape: async (url: string) => ({
			title: `Page: ${url}`,
			content: `Content from ${url}`
		})
	};

	beforeEach(async () => {
		db = createDb(':memory:');
		await initProjectDb(db);
		const topic = await createTopic(db, { name: 'Test Topic' });
		topicId = topic.id;
	});

	it('processes text inputs into sources', async () => {
		const result = await processSeed(
			db,
			topicId,
			[
				{ type: 'text', value: 'First note about agents' },
				{ type: 'text', value: 'Second note about HCI' }
			],
			{ filesDir: '/tmp/files' }
		);

		const seed = await getSeed(db, result.seedId);
		expect(seed!.status).toBe('ready');
		expect(seed!.processedCount).toBe(2);

		const sources = await listSourcesByTopic(db, topicId);
		expect(sources).toHaveLength(2);
	});

	it('processes URL inputs with scraper', async () => {
		const result = await processSeed(
			db,
			topicId,
			[{ type: 'url', value: 'https://example.com/article' }],
			{ filesDir: '/tmp/files', scraper: mockScraper }
		);

		expect(result.seedId).toBeTruthy();

		const sources = await listSourcesByTopic(db, topicId);
		expect(sources).toHaveLength(1);
		expect(sources[0].title).toBe('Page: https://example.com/article');
		expect(sources[0].originalUrl).toBe('https://example.com/article');
		expect(sources[0].provenance).toBe('Scraped: example.com');
	});

	it('populates provenance for text inputs', async () => {
		const result = await processSeed(
			db,
			topicId,
			[{ type: 'text', value: 'A note' }],
			{ filesDir: '/tmp/files' }
		);
		expect(result.seedId).toBeTruthy();

		const sources = await listSourcesByTopic(db, topicId);
		expect(sources[0].provenance).toBe('Pasted text');
	});

	it('handles partial failures gracefully', async () => {
		const failingScraper: UrlScraper = {
			scrape: async () => {
				throw new Error('Network timeout');
			}
		};

		const result = await processSeed(
			db,
			topicId,
			[
				{ type: 'text', value: 'This will succeed' },
				{ type: 'url', value: 'https://fail.example.com' }
			],
			{ filesDir: '/tmp/files', scraper: failingScraper }
		);

		const seed = await getSeed(db, result.seedId);
		expect(seed!.status).toBe('partial');
		expect(seed!.processedCount).toBe(1);
		expect(JSON.parse(seed!.failures!)).toHaveLength(1);

		const sources = await listSourcesByTopic(db, topicId);
		expect(sources).toHaveLength(1); // only the text input succeeded
	});

	it('sets status to failed when all inputs fail', async () => {
		const failingScraper: UrlScraper = {
			scrape: async () => {
				throw new Error('Fail');
			}
		};

		const result = await processSeed(
			db,
			topicId,
			[
				{ type: 'url', value: 'https://fail1.example.com' },
				{ type: 'url', value: 'https://fail2.example.com' }
			],
			{ filesDir: '/tmp/files', scraper: failingScraper }
		);

		const seed = await getSeed(db, result.seedId);
		expect(seed!.status).toBe('failed');
		expect(seed!.processedCount).toBe(0);
	});

	it('fails loudly on unsupported input types', async () => {
		const result = await processSeed(
			db,
			topicId,
			[
				{ type: 'youtube', value: 'https://youtu.be/abc' },
				{ type: 'tweet', value: 'https://x.com/u/status/1' },
				{ type: 'image', value: '/tmp/img.png' }
			],
			{ filesDir: '/tmp/files' }
		);

		const seed = await getSeed(db, result.seedId);
		expect(seed!.status).toBe('failed');
		expect(seed!.processedCount).toBe(0);

		const failures = JSON.parse(seed!.failures!) as Array<{ type: string; error: string }>;
		expect(failures).toHaveLength(3);
		for (const f of failures) {
			expect(f.error).toMatch(/not yet supported in Phase 2/i);
		}
	});

	it('sets correct origin for user submissions', async () => {
		const result = await processSeed(db, topicId, [{ type: 'text', value: 'note' }], {
			filesDir: '/tmp/files'
		});

		const seed = await getSeed(db, result.seedId);
		expect(seed!.origin).toBe('user');
	});
});

describe('processBriefingCard', () => {
	let db: ReturnType<typeof createDb>;
	let topicId: string;

	beforeEach(async () => {
		db = createDb(':memory:');
		await initProjectDb(db);
		const topic = await createTopic(db, { name: 'Original Name' });
		topicId = topic.id;
	});

	it('updates topic metadata from briefing card', async () => {
		await processBriefingCard(
			db,
			topicId,
			{
				guidance: 'Focus on open-source agent tools',
				narrativeThreads: ['MCP', 'A2A'],
				inputs: []
			},
			{ filesDir: '/tmp/files' }
		);

		const topic = await getTopic(db, topicId);
		expect(topic!.guidance).toBe('Focus on open-source agent tools');
		expect(JSON.parse(topic!.narrativeThreads!)).toEqual(['MCP', 'A2A']);
	});

	it('captures topic snapshot in the seed', async () => {
		const result = await processBriefingCard(
			db,
			topicId,
			{
				guidance: 'New guidance',
				narrativeThreads: ['thread1'],
				inputs: [{ type: 'text', value: 'A note' }]
			},
			{ filesDir: '/tmp/files' }
		);

		const seed = await getSeed(db, result.seedId);
		expect(seed!.type).toBe('briefing_card');
		const snapshot = JSON.parse(seed!.topicSnapshot!);
		expect(snapshot.guidance).toBe('New guidance');
	});

	it('processes attached inputs through handler pipeline', async () => {
		await processBriefingCard(
			db,
			topicId,
			{
				guidance: 'Research scope',
				narrativeThreads: [],
				inputs: [
					{ type: 'text', value: 'Research note 1' },
					{ type: 'text', value: 'Research note 2' }
				]
			},
			{ filesDir: '/tmp/files' }
		);

		const sources = await listSourcesByTopic(db, topicId);
		expect(sources).toHaveLength(2);
	});
});
