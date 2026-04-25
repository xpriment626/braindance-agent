import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type Database } from '../db/connection';
import { initProjectDb } from '../db/schema';
import { createTopic } from '../knowledge/topics';
import {
	createDiscoveryReport,
	reviewDiscoveryReport,
	type DiscoveredSourceProposal
} from '../knowledge/discovery-reports';
import {
	openDiscoveryReportForReview,
	acceptDiscoveredSource,
	declineDiscoveredSource
} from './promoteDiscoveredSource';
import { getSeed, getSeedByDiscoveryReport } from '../knowledge/seeds';
import { listSourcesBySeed } from '../knowledge/sources';
import { getDiscoveryReport } from '../knowledge/discovery-reports';

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

describe('acceptDiscoveredSource + declineDiscoveredSource', () => {
	let db: Database;
	let topicId: string;

	beforeEach(async () => {
		db = createDb(':memory:');
		await initProjectDb(db);
		const topic = await createTopic(db, { name: 'T1' });
		topicId = topic.id;
	});

	async function setup(proposals: DiscoveredSourceProposal[]): Promise<string> {
		const report = await createDiscoveryReport(db, {
			topicId,
			workflowRunId: 'wr-1',
			summary: null,
			newSources: proposals,
			auditFindings: {}
		});
		await openDiscoveryReportForReview(db, report.id);
		return report.id;
	}

	it('accept creates a source tied to the journalist seed and flips proposal status', async () => {
		const reportId = await setup([
			pendingProposal({ url: 'https://a', title: 'A' }),
			pendingProposal({ url: 'https://b', title: 'B' })
		]);
		const source = await acceptDiscoveredSource(db, reportId, 0);
		expect(source.title).toBe('A');
		expect(source.originalUrl).toBe('https://a');
		expect(source.topicId).toBe(topicId);

		const seed = await getSeedByDiscoveryReport(db, reportId);
		expect(source.seedId).toBe(seed!.id);

		const report = await getDiscoveryReport(db, reportId);
		expect(report!.newSources[0].status).toBe('accepted');
		expect(report!.newSources[1].status).toBe('pending');
	});

	it('decline flips proposal status without creating a source', async () => {
		const reportId = await setup([
			pendingProposal({ url: 'https://a', title: 'A' }),
			pendingProposal({ url: 'https://b', title: 'B' })
		]);
		await declineDiscoveredSource(db, reportId, 1);
		const seed = await getSeedByDiscoveryReport(db, reportId);
		const sources = await listSourcesBySeed(db, seed!.id);
		expect(sources).toHaveLength(0);

		const report = await getDiscoveryReport(db, reportId);
		expect(report!.newSources[1].status).toBe('declined');
	});

	it('both increment processed_count', async () => {
		const reportId = await setup([
			pendingProposal({ url: 'https://a' }),
			pendingProposal({ url: 'https://b' }),
			pendingProposal({ url: 'https://c' })
		]);
		await acceptDiscoveredSource(db, reportId, 0);
		await declineDiscoveredSource(db, reportId, 1);
		const seed = await getSeedByDiscoveryReport(db, reportId);
		expect(seed!.processedCount).toBe(2);
		expect(seed!.status).toBe('processing');
	});

	it('when the last proposal is acted on, seed → ready and report → reviewed', async () => {
		const reportId = await setup([
			pendingProposal({ url: 'https://a' }),
			pendingProposal({ url: 'https://b' })
		]);
		await acceptDiscoveredSource(db, reportId, 0);
		await declineDiscoveredSource(db, reportId, 1);

		const seedId = (await getSeedByDiscoveryReport(db, reportId))!.id;
		const seed = await getSeed(db, seedId);
		expect(seed!.processedCount).toBe(2);
		expect(seed!.status).toBe('ready');

		const report = await getDiscoveryReport(db, reportId);
		expect(report!.status).toBe('reviewed');
	});

	it('throws when the report has no open review', async () => {
		const report = await createDiscoveryReport(db, {
			topicId,
			workflowRunId: 'wr-1',
			summary: null,
			newSources: [pendingProposal()],
			auditFindings: {}
		});
		await expect(
			acceptDiscoveredSource(db, report.id, 0)
		).rejects.toThrow(/open review/);
	});

	it('throws on out-of-bounds proposal index', async () => {
		const reportId = await setup([pendingProposal()]);
		await expect(acceptDiscoveredSource(db, reportId, 5)).rejects.toThrow(/out of bounds/);
		await expect(declineDiscoveredSource(db, reportId, -1)).rejects.toThrow(/out of bounds/);
	});

	it('throws when acting on an already-acted proposal', async () => {
		const reportId = await setup([pendingProposal(), pendingProposal()]);
		await acceptDiscoveredSource(db, reportId, 0);
		await expect(acceptDiscoveredSource(db, reportId, 0)).rejects.toThrow(/already accepted/);
		await expect(declineDiscoveredSource(db, reportId, 0)).rejects.toThrow(/already accepted/);
	});
});
