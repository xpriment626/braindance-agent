import type { Database } from '../db/connection';
import type { AuditOutput, AuditSignal } from '../agents/types';
import { createSignal, type Signal } from '../knowledge/signals';

// Converts an AuditOutput into pending signals. Returns the created signal ids
// in the order they were persisted (freshness → contradictions → gaps → consolidations).
//
// `discoveryReportId` ties each signal to its parent report when audit ran as
// part of `add_knowledge`. Pass `null` (or omit) for `audit_corpus` standalone
// runs — those signals stay null-scoped and surface only in Maintenance.
export async function persistAuditSignals(
	db: Database,
	topicId: string,
	audit: AuditOutput,
	discoveryReportId: string | null = null
): Promise<string[]> {
	const ids: string[] = [];
	for (const flag of audit.freshnessFlags) {
		ids.push((await createAuditSourceSignal(db, topicId, flag, discoveryReportId)).id);
	}
	for (const flag of audit.contradictions) {
		ids.push((await createAuditSourceSignal(db, topicId, flag, discoveryReportId)).id);
	}
	for (const gap of audit.gapAnalysis) {
		if (gap.coverage === 'strong') continue;
		const signal = await createSignal(db, {
			topicId,
			discoveryReportId,
			targetType: 'thread',
			targetId: topicId,
			signalType: 'gap',
			reason: gap.notes,
			raisedBy: 'audit',
			metadata: { thread: gap.thread, coverage: gap.coverage }
		});
		ids.push(signal.id);
	}
	for (const consolidation of audit.consolidationSuggestions) {
		const [canonical, ...superseded] = consolidation.sourceIds;
		if (!canonical) continue;
		const signal = await createSignal(db, {
			topicId,
			discoveryReportId,
			targetType: 'source',
			targetId: canonical,
			signalType: 'consolidation',
			reason: consolidation.reason,
			raisedBy: 'audit',
			metadata: { canonicalId: canonical, supersededIds: superseded }
		});
		ids.push(signal.id);
	}
	return ids;
}

async function createAuditSourceSignal(
	db: Database,
	topicId: string,
	flag: AuditSignal,
	discoveryReportId: string | null
): Promise<Signal> {
	return createSignal(db, {
		topicId,
		discoveryReportId,
		targetType: 'source',
		targetId: flag.targetId,
		signalType: flag.signalType,
		reason: flag.reason,
		raisedBy: 'audit'
	});
}
