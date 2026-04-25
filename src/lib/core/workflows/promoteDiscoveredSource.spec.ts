import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type Database } from '../db/connection';
import { initProjectDb } from '../db/schema';
import { createTopic } from '../knowledge/topics';
import {
	createDiscoveryReport,
	reviewDiscoveryReport,
	type DiscoveredSourceProposal
} from '../knowledge/discovery-reports';
import { openDiscoveryReportForReview } from './promoteDiscoveredSource';

function pendingProposal(overrides: Partial<DiscoveredSourceProposal> = {}): DiscoveredSourceProposal {
	return {
		url: 'https://a.example',
		title: 'A',
		content: 'body',
		channel: 'web',
		status: 'pending',
		...overrides
	};
}

describe('openDiscoveryReportForReview', () => {
	let db: Database;
	let topicId: string;

	beforeEach(async () => {
		db = createDb(':memory:');
		await initProjectDb(db);
		const topic = await createTopic(db, { name: 'T1' });
		topicId = topic.id;
	});

	it('creates a journalist seed whose input_count = proposal count and links to the report', async () => {
		const report = await createDiscoveryReport(db, {
			topicId,
			workflowRunId: 'wr-1',
			summary: null,
			newSources: [
				pendingProposal({ url: 'https://a' }),
				pendingProposal({ url: 'https://b' }),
				pendingProposal({ url: 'https://c' })
			],
			auditFindings: {}
		});
		const { seed } = await openDiscoveryReportForReview(db, report.id);
		expect(seed.origin).toBe('journalist');
		expect(seed.type).toBe('freeform');
		expect(seed.topicId).toBe(topicId);
		expect(seed.inputCount).toBe(3);
		expect(seed.processedCount).toBe(0);
		expect(seed.discoveryReportId).toBe(report.id);
		expect(seed.status).toBe('processing');
	});

	it('is idempotent — returns the same seed on repeated calls', async () => {
		const report = await createDiscoveryReport(db, {
			topicId,
			workflowRunId: 'wr-1',
			summary: null,
			newSources: [pendingProposal()],
			auditFindings: {}
		});
		const first = await openDiscoveryReportForReview(db, report.id);
		const second = await openDiscoveryReportForReview(db, report.id);
		expect(second.seed.id).toBe(first.seed.id);
	});

	it('throws when the report does not exist', async () => {
		await expect(
			openDiscoveryReportForReview(db, 'nope')
		).rejects.toThrow(/not found/);
	});

	it('throws when the report is not pending', async () => {
		const report = await createDiscoveryReport(db, {
			topicId,
			workflowRunId: 'wr-1',
			summary: null,
			newSources: [pendingProposal()],
			auditFindings: {}
		});
		await reviewDiscoveryReport(db, report.id);
		await expect(
			openDiscoveryReportForReview(db, report.id)
		).rejects.toThrow(/pending/);
	});

	it('throws when the report has no proposals', async () => {
		const report = await createDiscoveryReport(db, {
			topicId,
			workflowRunId: 'wr-1',
			summary: null,
			newSources: [],
			auditFindings: {}
		});
		await expect(
			openDiscoveryReportForReview(db, report.id)
		).rejects.toThrow(/no proposals/);
	});
});
