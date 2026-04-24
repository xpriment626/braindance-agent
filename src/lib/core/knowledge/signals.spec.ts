import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type Database } from '../db/connection';
import { initProjectDb } from '../db/schema';
import {
	createSignal,
	getSignal,
	listSignalsByTopic,
	listApprovedSignals,
	approveSignal,
	dismissSignal,
	applySignal
} from './signals';

describe('signals lifecycle', () => {
	let db: Database;

	beforeEach(async () => {
		db = createDb(':memory:');
		await initProjectDb(db);
	});

	it('createSignal returns a record with status=pending and a fresh id', async () => {
		const signal = await createSignal(db, {
			topicId: 'topic-1',
			targetType: 'source',
			targetId: 'src-1',
			signalType: 'stale',
			reason: 'last updated > 12 months ago',
			raisedBy: 'audit',
			metadata: { freshnessScore: 0.2 }
		});
		expect(signal.status).toBe('pending');
		expect(signal.id).toBeTruthy();
		expect(signal.metadata).toEqual({ freshnessScore: 0.2 });
		expect(signal.resolvedAt).toBeNull();
	});

	it('getSignal returns the record back', async () => {
		const created = await createSignal(db, {
			topicId: 'topic-1',
			targetType: 'source',
			targetId: 'src-1',
			signalType: 'stale',
			reason: 'old',
			raisedBy: 'audit'
		});
		const fetched = await getSignal(db, created.id);
		expect(fetched?.id).toBe(created.id);
		expect(fetched?.status).toBe('pending');
	});

	it('listSignalsByTopic returns all signals for a topic when no status filter', async () => {
		await createSignal(db, {
			topicId: 'topic-a',
			targetType: 'source',
			targetId: 'src-1',
			signalType: 'stale',
			raisedBy: 'audit'
		});
		await createSignal(db, {
			topicId: 'topic-a',
			targetType: 'source',
			targetId: 'src-2',
			signalType: 'contested',
			raisedBy: 'audit'
		});
		await createSignal(db, {
			topicId: 'topic-b',
			targetType: 'source',
			targetId: 'src-3',
			signalType: 'stale',
			raisedBy: 'audit'
		});
		const all = await listSignalsByTopic(db, 'topic-a');
		expect(all).toHaveLength(2);
	});

	it('listSignalsByTopic filters by status when provided', async () => {
		const s1 = await createSignal(db, {
			topicId: 'topic-a',
			targetType: 'source',
			targetId: 'src-1',
			signalType: 'stale',
			raisedBy: 'audit'
		});
		await createSignal(db, {
			topicId: 'topic-a',
			targetType: 'source',
			targetId: 'src-2',
			signalType: 'contested',
			raisedBy: 'audit'
		});
		await approveSignal(db, s1.id);
		const approved = await listSignalsByTopic(db, 'topic-a', 'approved');
		expect(approved).toHaveLength(1);
		expect(approved[0].id).toBe(s1.id);
	});

	it('approveSignal moves pending → approved and sets resolvedAt', async () => {
		const s = await createSignal(db, {
			topicId: 'topic-1',
			targetType: 'source',
			targetId: 'src-1',
			signalType: 'stale',
			raisedBy: 'audit'
		});
		const approved = await approveSignal(db, s.id);
		expect(approved.status).toBe('approved');
		expect(approved.resolvedAt).toBeTruthy();
	});

	it('approveSignal rejects non-pending transitions', async () => {
		const s = await createSignal(db, {
			topicId: 'topic-1',
			targetType: 'source',
			targetId: 'src-1',
			signalType: 'stale',
			raisedBy: 'audit'
		});
		await approveSignal(db, s.id);
		await expect(approveSignal(db, s.id)).rejects.toThrow(/pending/);
	});

	it('dismissSignal moves pending → dismissed with reason', async () => {
		const s = await createSignal(db, {
			topicId: 'topic-1',
			targetType: 'source',
			targetId: 'src-1',
			signalType: 'stale',
			raisedBy: 'audit'
		});
		const dismissed = await dismissSignal(db, s.id, 'false positive — source still authoritative');
		expect(dismissed.status).toBe('dismissed');
		expect(dismissed.reason).toContain('false positive');
	});

	it('applySignal moves approved → applied', async () => {
		const s = await createSignal(db, {
			topicId: 'topic-1',
			targetType: 'source',
			targetId: 'src-1',
			signalType: 'stale',
			raisedBy: 'audit'
		});
		await approveSignal(db, s.id);
		const applied = await applySignal(db, s.id);
		expect(applied.status).toBe('applied');
	});

	it('applySignal rejects non-approved transitions', async () => {
		const s = await createSignal(db, {
			topicId: 'topic-1',
			targetType: 'source',
			targetId: 'src-1',
			signalType: 'stale',
			raisedBy: 'audit'
		});
		await expect(applySignal(db, s.id)).rejects.toThrow(/approved/);
	});

	it('listApprovedSignals returns approved signals for a topic', async () => {
		const s1 = await createSignal(db, {
			topicId: 'topic-a',
			targetType: 'source',
			targetId: 'src-1',
			signalType: 'stale',
			raisedBy: 'audit'
		});
		const s2 = await createSignal(db, {
			topicId: 'topic-a',
			targetType: 'source',
			targetId: 'src-2',
			signalType: 'contested',
			raisedBy: 'audit'
		});
		await approveSignal(db, s1.id);
		await approveSignal(db, s2.id);
		await applySignal(db, s1.id);
		const approved = await listApprovedSignals(db, 'topic-a');
		expect(approved.map((s) => s.id)).toEqual([s2.id]);
	});
});
