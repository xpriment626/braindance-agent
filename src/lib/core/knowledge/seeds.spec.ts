import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../db/connection';
import { initProjectDb } from '../db/schema';
import { createTopic } from './topics';
import { createSeed, getSeed, incrementProcessedCount, completeSeed } from './seeds';

describe('seed lifecycle', () => {
	let db: ReturnType<typeof createDb>;
	let topicId: string;

	beforeEach(async () => {
		db = createDb(':memory:');
		await initProjectDb(db);
		const topic = await createTopic(db, { name: 'Test Topic' });
		topicId = topic.id;
	});

	describe('createSeed', () => {
		it('creates a seed with processing status', async () => {
			const seed = await createSeed(db, {
				topicId,
				type: 'freeform',
				origin: 'user',
				inputCount: 3
			});
			expect(seed.id).toHaveLength(26);
			expect(seed.status).toBe('processing');
			expect(seed.inputCount).toBe(3);
			expect(seed.processedCount).toBe(0);
			expect(seed.failures).toBeNull();
		});

		it('stores topic snapshot for briefing card seeds', async () => {
			const snapshot = { guidance: 'Focus on X', narrativeThreads: ['thread1'] };
			const seed = await createSeed(db, {
				topicId,
				type: 'briefing_card',
				origin: 'user',
				inputCount: 1,
				topicSnapshot: snapshot
			});
			expect(JSON.parse(seed.topicSnapshot!)).toEqual(snapshot);
		});
	});

	describe('getSeed', () => {
		it('returns seed by id', async () => {
			const created = await createSeed(db, {
				topicId,
				type: 'freeform',
				origin: 'user',
				inputCount: 1
			});
			const found = await getSeed(db, created.id);
			expect(found).not.toBeNull();
			expect(found!.id).toBe(created.id);
		});

		it('returns null for unknown id', async () => {
			const found = await getSeed(db, 'nonexistent');
			expect(found).toBeNull();
		});
	});

	describe('incrementProcessedCount', () => {
		it('increments the processed count', async () => {
			const seed = await createSeed(db, {
				topicId,
				type: 'freeform',
				origin: 'user',
				inputCount: 3
			});
			await incrementProcessedCount(db, seed.id);
			await incrementProcessedCount(db, seed.id);
			const updated = await getSeed(db, seed.id);
			expect(updated!.processedCount).toBe(2);
		});
	});

	describe('completeSeed', () => {
		it('sets status to ready when all inputs succeed', async () => {
			const seed = await createSeed(db, {
				topicId,
				type: 'freeform',
				origin: 'user',
				inputCount: 2
			});
			await incrementProcessedCount(db, seed.id);
			await incrementProcessedCount(db, seed.id);
			await completeSeed(db, seed.id);

			const completed = await getSeed(db, seed.id);
			expect(completed!.status).toBe('ready');
			expect(completed!.completedAt).toBeTruthy();
			expect(completed!.failures).toBeNull();
		});

		it('sets status to partial when some inputs fail', async () => {
			const seed = await createSeed(db, {
				topicId,
				type: 'freeform',
				origin: 'user',
				inputCount: 3
			});
			await incrementProcessedCount(db, seed.id);
			const failures = [{ inputIndex: 1, type: 'url', error: 'Timeout' }];
			await completeSeed(db, seed.id, failures);

			const completed = await getSeed(db, seed.id);
			expect(completed!.status).toBe('partial');
			expect(JSON.parse(completed!.failures!)).toHaveLength(1);
		});

		it('sets status to failed when all inputs fail', async () => {
			const seed = await createSeed(db, {
				topicId,
				type: 'freeform',
				origin: 'user',
				inputCount: 2
			});
			const failures = [
				{ inputIndex: 0, type: 'url', error: 'Timeout' },
				{ inputIndex: 1, type: 'url', error: '404' }
			];
			await completeSeed(db, seed.id, failures);

			const completed = await getSeed(db, seed.id);
			expect(completed!.status).toBe('failed');
		});
	});
});
