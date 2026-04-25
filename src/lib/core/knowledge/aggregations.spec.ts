import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type Database } from '../db/connection';
import { initProjectDb } from '../db/schema';
import { createTopic } from './topics';
import { createSeed } from './seeds';
import { createSource } from './sources';
import { createSignal, approveSignal } from './signals';
import { createDiscoveryReport, dismissDiscoveryReport } from './discovery-reports';
import { generateId } from '../db/id';
import {
	countSourcesByTopic,
	countPendingSignalsByTopic,
	countPendingDiscoveryReportsByProject,
	corpusHealthByTopic,
	threadCoverageByTopic
} from './aggregations';

describe('aggregations', () => {
	let db: Database;
	let topicId: string;
	let otherTopicId: string;

	beforeEach(async () => {
		db = createDb(':memory:');
		await initProjectDb(db);
		const topic = await createTopic(db, {
			name: 'Target',
			narrativeThreads: ['mcp', 'a2a', 'inference']
		});
		topicId = topic.id;
		const other = await createTopic(db, { name: 'Other' });
		otherTopicId = other.id;
	});

	async function addSource(tId: string): Promise<void> {
		const seed = await createSeed(db, {
			topicId: tId,
			type: 'freeform',
			origin: 'user',
			inputCount: 1
		});
		await createSource(db, {
			id: generateId(),
			seedId: seed.id,
			topicId: tId,
			title: 'src',
			type: 'text',
			content: 'body',
			originalFormat: 'text/plain'
		});
	}

	it('countSourcesByTopic counts sources for the topic only', async () => {
		await addSource(topicId);
		await addSource(topicId);
		await addSource(otherTopicId);
		expect(await countSourcesByTopic(db, topicId)).toBe(2);
		expect(await countSourcesByTopic(db, otherTopicId)).toBe(1);
	});

	it('countPendingSignalsByTopic excludes non-pending statuses', async () => {
		const s1 = await createSignal(db, {
			topicId,
			targetType: 'source',
			targetId: 'src-1',
			signalType: 'stale',
			raisedBy: 'audit'
		});
		await createSignal(db, {
			topicId,
			targetType: 'source',
			targetId: 'src-2',
			signalType: 'gap',
			raisedBy: 'audit'
		});
		await createSignal(db, {
			topicId: otherTopicId,
			targetType: 'source',
			targetId: 'src-3',
			signalType: 'stale',
			raisedBy: 'audit'
		});
		expect(await countPendingSignalsByTopic(db, topicId)).toBe(2);
		await approveSignal(db, s1.id);
		expect(await countPendingSignalsByTopic(db, topicId)).toBe(1);
	});

	it('countPendingDiscoveryReportsByProject counts across topics, excludes dismissed', async () => {
		await createDiscoveryReport(db, {
			topicId,
			workflowRunId: 'wr-1',
			summary: null,
			newSources: [],
			auditFindings: {}
		});
		const r2 = await createDiscoveryReport(db, {
			topicId: otherTopicId,
			workflowRunId: 'wr-2',
			summary: null,
			newSources: [],
			auditFindings: {}
		});
		expect(await countPendingDiscoveryReportsByProject(db)).toBe(2);
		await dismissDiscoveryReport(db, r2.id);
		expect(await countPendingDiscoveryReportsByProject(db)).toBe(1);
	});

	it('corpusHealthByTopic groups pending signals by type', async () => {
		for (const signalType of ['stale', 'stale', 'gap', 'contested', 'consolidation'] as const) {
			await createSignal(db, {
				topicId,
				targetType: 'source',
				targetId: generateId(),
				signalType,
				raisedBy: 'audit'
			});
		}
		const approved = await createSignal(db, {
			topicId,
			targetType: 'source',
			targetId: 'x',
			signalType: 'stale',
			raisedBy: 'audit'
		});
		await approveSignal(db, approved.id);
		const health = await corpusHealthByTopic(db, topicId);
		expect(health).toEqual({
			fresh: 0,
			stale: 2,
			contested: 1,
			gaps: 1,
			retracted: 0,
			consolidation: 1
		});
	});

	it('threadCoverageByTopic returns strong for threads with no gap signals', async () => {
		const coverage = await threadCoverageByTopic(db, topicId);
		expect(coverage).toEqual([
			{ thread: 'mcp', coverage: 'strong', signalCount: 0 },
			{ thread: 'a2a', coverage: 'strong', signalCount: 0 },
			{ thread: 'inference', coverage: 'strong', signalCount: 0 }
		]);
	});

	it('threadCoverageByTopic reflects gap signals per thread', async () => {
		await createSignal(db, {
			topicId,
			targetType: 'thread',
			targetId: 'mcp',
			signalType: 'gap',
			raisedBy: 'audit',
			metadata: { thread: 'mcp', coverage: 'thin' }
		});
		await createSignal(db, {
			topicId,
			targetType: 'thread',
			targetId: 'a2a',
			signalType: 'gap',
			raisedBy: 'audit',
			metadata: { thread: 'a2a', coverage: 'missing' }
		});
		const coverage = await threadCoverageByTopic(db, topicId);
		expect(coverage.find((t) => t.thread === 'mcp')?.coverage).toBe('thin');
		expect(coverage.find((t) => t.thread === 'a2a')?.coverage).toBe('missing');
		expect(coverage.find((t) => t.thread === 'inference')?.coverage).toBe('strong');
	});

	it('threadCoverageByTopic returns [] for topic with no threads', async () => {
		const bare = await createTopic(db, { name: 'Bare' });
		expect(await threadCoverageByTopic(db, bare.id)).toEqual([]);
	});
});
