import type { Database } from '../db/connection';
import {
	getDiscoveryReport,
	type DiscoveryReport
} from '../knowledge/discovery-reports';
import {
	createSeed,
	getSeedByDiscoveryReport,
	type Seed
} from '../knowledge/seeds';

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
