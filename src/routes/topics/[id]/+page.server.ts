import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCurrentProject } from '$lib/core/projects/current';
import { getTopic } from '$lib/core/knowledge/topics';
import { listDiscoveryReportsByTopic } from '$lib/core/knowledge/discovery-reports';
import { listSourcesByTopic } from '$lib/core/knowledge/sources';

export const load: PageServerLoad = async ({ params, cookies }) => {
	const { handle } = await getCurrentProject(cookies);
	if (!handle) throw error(404, 'No active project');

	const topic = await getTopic(handle.db, params.id);
	if (!topic) throw error(404, `Topic "${params.id}" not found`);

	const [reports, sources] = await Promise.all([
		listDiscoveryReportsByTopic(handle.db, topic.id),
		listSourcesByTopic(handle.db, topic.id)
	]);

	// Recent-first across both lists. Phase B spec decisions 9 + 11.
	const reportsSorted = reports
		.slice()
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	const sourcesSorted = sources
		.slice()
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

	const pendingReportCount = reports.filter((r) => r.status === 'pending').length;

	return {
		topic: {
			id: topic.id,
			name: topic.name,
			description: topic.description,
			narrativeThreads: topic.narrativeThreads
				? (JSON.parse(topic.narrativeThreads) as string[])
				: []
		},
		reports: reportsSorted.map((r) => ({
			id: r.id,
			status: r.status,
			summary: r.summary,
			createdAt: r.createdAt,
			reviewedAt: r.reviewedAt,
			proposalCount: r.newSources.length,
			acceptedCount: r.newSources.filter((p) => p.status === 'accepted').length,
			declinedCount: r.newSources.filter((p) => p.status === 'declined').length,
			// auditFindings is JSON; we surface a count where possible. Phase B
			// passes the raw JSON forward and the page derives a rough findings
			// count for the inbox row label.
			auditFindingsCount: countAuditFindings(r.auditFindings)
		})),
		sources: sourcesSorted.map((s) => ({
			id: s.id,
			title: s.title,
			type: s.type,
			originalUrl: s.originalUrl,
			provenance: s.provenance,
			createdAt: s.createdAt
		})),
		sourceCount: sources.length,
		pendingReportCount
	};
};

// Audit findings ship as a freeform JSON blob today. We try to count its leaf
// items for an inbox row label ("4 audit findings"); falls back to 0 on shape
// surprises so an inbox row never crashes the page-load.
function countAuditFindings(findings: Record<string, unknown>): number {
	let n = 0;
	for (const value of Object.values(findings ?? {})) {
		if (Array.isArray(value)) n += value.length;
	}
	return n;
}
