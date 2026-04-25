import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type Database } from '../db/connection';
import { initProjectDb } from '../db/schema';
import {
	createDiscoveryReport,
	getDiscoveryReport,
	listDiscoveryReportsByTopic,
	reviewDiscoveryReport,
	dismissDiscoveryReport
} from './discovery-reports';

describe('discovery_reports lifecycle', () => {
	let db: Database;

	beforeEach(async () => {
		db = createDb(':memory:');
		await initProjectDb(db);
	});

	it('createDiscoveryReport persists with status=pending and parses JSON back on read', async () => {
		const report = await createDiscoveryReport(db, {
			topicId: 'topic-1',
			workflowRunId: 'wr-1',
			summary: 'Added 3 new sources on transformer inference',
			newSources: [
				{ url: 'https://a.example', title: 'A', confidence: 0.9, status: 'pending' }
			],
			auditFindings: { freshnessFlags: [{ targetId: 'src-x', reason: 'old' }] }
		});
		expect(report.status).toBe('pending');
		expect(report.id).toBeTruthy();
		expect(report.newSources).toEqual([
			{ url: 'https://a.example', title: 'A', confidence: 0.9, status: 'pending' }
		]);
		expect(report.auditFindings).toEqual({
			freshnessFlags: [{ targetId: 'src-x', reason: 'old' }]
		});
		expect(report.reviewedAt).toBeNull();
	});

	it('defaults missing proposal status to "pending" on read (back-compat)', async () => {
		const created = await createDiscoveryReport(db, {
			topicId: 'topic-1',
			workflowRunId: 'wr-1',
			summary: null,
			newSources: [],
			auditFindings: {}
		});
		const { discoveryReports } = await import('../db/schema');
		const { eq } = await import('drizzle-orm');
		await db
			.update(discoveryReports)
			.set({
				newSources: JSON.stringify([{ url: 'https://x', title: 'X' }])
			})
			.where(eq(discoveryReports.id, created.id));
		const reread = await getDiscoveryReport(db, created.id);
		expect(reread?.newSources[0].status).toBe('pending');
	});

	it('getDiscoveryReport returns the record back', async () => {
		const created = await createDiscoveryReport(db, {
			topicId: 'topic-1',
			workflowRunId: 'wr-1',
			summary: 's',
			newSources: [],
			auditFindings: {}
		});
		const fetched = await getDiscoveryReport(db, created.id);
		expect(fetched?.id).toBe(created.id);
	});

	it('listDiscoveryReportsByTopic filters by topic', async () => {
		await createDiscoveryReport(db, {
			topicId: 'topic-a',
			workflowRunId: 'wr-1',
			summary: 's',
			newSources: [],
			auditFindings: {}
		});
		await createDiscoveryReport(db, {
			topicId: 'topic-b',
			workflowRunId: 'wr-2',
			summary: 's',
			newSources: [],
			auditFindings: {}
		});
		const forA = await listDiscoveryReportsByTopic(db, 'topic-a');
		expect(forA).toHaveLength(1);
	});

	it('reviewDiscoveryReport moves pending → reviewed and stamps reviewedAt', async () => {
		const r = await createDiscoveryReport(db, {
			topicId: 'topic-1',
			workflowRunId: 'wr-1',
			summary: 's',
			newSources: [],
			auditFindings: {}
		});
		const reviewed = await reviewDiscoveryReport(db, r.id);
		expect(reviewed.status).toBe('reviewed');
		expect(reviewed.reviewedAt).toBeTruthy();
	});

	it('reviewDiscoveryReport rejects transitions from non-pending status', async () => {
		const r = await createDiscoveryReport(db, {
			topicId: 'topic-1',
			workflowRunId: 'wr-1',
			summary: 's',
			newSources: [],
			auditFindings: {}
		});
		await reviewDiscoveryReport(db, r.id);
		await expect(reviewDiscoveryReport(db, r.id)).rejects.toThrow(/pending/);
	});

	it('dismissDiscoveryReport moves pending → dismissed', async () => {
		const r = await createDiscoveryReport(db, {
			topicId: 'topic-1',
			workflowRunId: 'wr-1',
			summary: 's',
			newSources: [],
			auditFindings: {}
		});
		const dismissed = await dismissDiscoveryReport(db, r.id);
		expect(dismissed.status).toBe('dismissed');
	});
});
