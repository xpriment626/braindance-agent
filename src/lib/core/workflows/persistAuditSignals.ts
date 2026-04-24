import type { Database } from '../db/connection';
import type { AuditOutput, AuditSignal } from '../agents/types';
import { createSignal, type Signal } from '../knowledge/signals';

// Converts an AuditOutput into pending signals. Returns the created signal ids
// in the order they were persisted (freshness → contradictions → gaps → consolidations).
export async function persistAuditSignals(
	db: Database,
	topicId: string,
	audit: AuditOutput
): Promise<string[]> {
	const ids: string[] = [];
	for (const flag of audit.freshnessFlags) {
		ids.push((await createAuditSourceSignal(db, topicId, flag)).id);
	}
	for (const flag of audit.contradictions) {
		ids.push((await createAuditSourceSignal(db, topicId, flag)).id);
	}
	for (const gap of audit.gapAnalysis) {
		if (gap.coverage === 'strong') continue;
		const signal = await createSignal(db, {
			topicId,
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
	flag: AuditSignal
): Promise<Signal> {
	return createSignal(db, {
		topicId,
		targetType: 'source',
		targetId: flag.targetId,
		signalType: flag.signalType,
		reason: flag.reason,
		raisedBy: 'audit'
	});
}
