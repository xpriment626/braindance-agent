import type { Database } from '../db/connection';
import {
	getDiscoveryReport,
	updateDiscoveredSources,
	reviewDiscoveryReport,
	type DiscoveryReport,
	type DiscoveredSourceProposal
} from '../knowledge/discovery-reports';
import {
	createSeed,
	getSeedByDiscoveryReport,
	incrementProcessedCount,
	completeSeed,
	type Seed
} from '../knowledge/seeds';
import { createSource, type Source } from '../knowledge/sources';
import { generateId } from '../db/id';

export interface OpenDiscoveryReportForReviewResult {
	report: DiscoveryReport;
	seed: Seed;
}

/**
 * Eagerly create the shared journalist seed for a discovery report when the
 * user opens it for review. Idempotent — returns the existing seed if one was
 * already created for this report.
 *
 * Contract (Spec 1 §2, B1 promotion):
 * - One seed per discovery_report with origin="journalist", type="freeform".
 * - input_count = number of proposals at open time (immutable per seed).
 * - processed_count starts at 0, increments on accept AND decline.
 */
export async function openDiscoveryReportForReview(
	db: Database,
	reportId: string
): Promise<OpenDiscoveryReportForReviewResult> {
	const report = await getDiscoveryReport(db, reportId);
	if (!report) throw new Error(`discovery_report "${reportId}" not found`);
	if (report.status !== 'pending') {
		throw new Error(
			`discovery_report "${reportId}" is ${report.status}, expected pending`
		);
	}
	if (report.newSources.length === 0) {
		throw new Error(`discovery_report "${reportId}" has no proposals to review`);
	}

	const existing = await getSeedByDiscoveryReport(db, reportId);
	if (existing) return { report, seed: existing };

	const seed = await createSeed(db, {
		topicId: report.topicId,
		type: 'freeform',
		origin: 'journalist',
		inputCount: report.newSources.length,
		discoveryReportId: reportId
	});

	return { report, seed };
}

function buildProvenance(
	proposal: DiscoveredSourceProposal,
	reportCreatedAt: string
): string {
	const channel = proposal.channel ?? 'discovery';
	return `discovered via ${channel} on ${reportCreatedAt}`;
}

async function advanceIfComplete(
	db: Database,
	reportId: string,
	seed: Seed,
	newProcessed: number
): Promise<void> {
	if (newProcessed < seed.inputCount) return;
	await completeSeed(db, seed.id);
	await reviewDiscoveryReport(db, reportId);
}

export async function acceptDiscoveredSource(
	db: Database,
	reportId: string,
	proposalIndex: number
): Promise<Source> {
	const seed = await getSeedByDiscoveryReport(db, reportId);
	if (!seed) {
		throw new Error(
			`discovery_report "${reportId}" has no open review — call openDiscoveryReportForReview first`
		);
	}
	const report = await getDiscoveryReport(db, reportId);
	if (!report) throw new Error(`discovery_report "${reportId}" not found`);

	const proposal = report.newSources[proposalIndex];
	if (!proposal) {
		throw new Error(
			`proposal index ${proposalIndex} out of bounds (report has ${report.newSources.length} proposals)`
		);
	}
	if (proposal.status !== 'pending') {
		throw new Error(
			`proposal ${proposalIndex} already ${proposal.status} — cannot accept`
		);
	}

	const source = await createSource(db, {
		id: generateId(),
		seedId: seed.id,
		topicId: report.topicId,
		title: proposal.title,
		type: proposal.url ? 'url' : 'text',
		content: proposal.content ?? '',
		originalFormat: proposal.url ? 'text/html' : 'text/plain',
		originalUrl: proposal.url,
		provenance: buildProvenance(proposal, report.createdAt)
	});

	const updatedProposals = report.newSources.map((p, i) =>
		i === proposalIndex ? { ...p, status: 'accepted' as const } : p
	);
	await updateDiscoveredSources(db, reportId, updatedProposals);
	await incrementProcessedCount(db, seed.id);
	await advanceIfComplete(db, reportId, seed, seed.processedCount + 1);

	return source;
}

export async function declineDiscoveredSource(
	db: Database,
	reportId: string,
	proposalIndex: number
): Promise<void> {
	const seed = await getSeedByDiscoveryReport(db, reportId);
	if (!seed) {
		throw new Error(
			`discovery_report "${reportId}" has no open review — call openDiscoveryReportForReview first`
		);
	}
	const report = await getDiscoveryReport(db, reportId);
	if (!report) throw new Error(`discovery_report "${reportId}" not found`);

	const proposal = report.newSources[proposalIndex];
	if (!proposal) {
		throw new Error(
			`proposal index ${proposalIndex} out of bounds (report has ${report.newSources.length} proposals)`
		);
	}
	if (proposal.status !== 'pending') {
		throw new Error(
			`proposal ${proposalIndex} already ${proposal.status} — cannot decline`
		);
	}

	const updatedProposals = report.newSources.map((p, i) =>
		i === proposalIndex ? { ...p, status: 'declined' as const } : p
	);
	await updateDiscoveredSources(db, reportId, updatedProposals);
	await incrementProcessedCount(db, seed.id);
	await advanceIfComplete(db, reportId, seed, seed.processedCount + 1);
}
