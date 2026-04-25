import { and, count, eq } from 'drizzle-orm';
import { sources, signals, discoveryReports } from '../db/schema';
import type { Database } from '../db/connection';
import type { SignalType } from './signals';

export async function countSourcesByTopic(db: Database, topicId: string): Promise<number> {
	const result = await db
		.select({ n: count() })
		.from(sources)
		.where(eq(sources.topicId, topicId));
	return result[0]?.n ?? 0;
}

export async function countPendingSignalsByTopic(
	db: Database,
	topicId: string
): Promise<number> {
	const result = await db
		.select({ n: count() })
		.from(signals)
		.where(and(eq(signals.topicId, topicId), eq(signals.status, 'pending')));
	return result[0]?.n ?? 0;
}

export async function countPendingDiscoveryReportsByProject(db: Database): Promise<number> {
	const result = await db
		.select({ n: count() })
		.from(discoveryReports)
		.where(eq(discoveryReports.status, 'pending'));
	return result[0]?.n ?? 0;
}

export interface CorpusHealth {
	fresh: number;
	stale: number;
	contested: number;
	gaps: number;
	retracted: number;
	consolidation: number;
}

const SIGNAL_TYPE_TO_HEALTH_KEY: Record<SignalType, keyof CorpusHealth> = {
	fresh: 'fresh',
	stale: 'stale',
	contested: 'contested',
	gap: 'gaps',
	retracted: 'retracted',
	consolidation: 'consolidation'
};

export async function corpusHealthByTopic(
	db: Database,
	topicId: string
): Promise<CorpusHealth> {
	const health: CorpusHealth = {
		fresh: 0,
		stale: 0,
		contested: 0,
		gaps: 0,
		retracted: 0,
		consolidation: 0
	};
	const rows = await db
		.select({ signalType: signals.signalType, n: count() })
		.from(signals)
		.where(and(eq(signals.topicId, topicId), eq(signals.status, 'pending')))
		.groupBy(signals.signalType);
	for (const row of rows) {
		const key = SIGNAL_TYPE_TO_HEALTH_KEY[row.signalType as SignalType];
		if (key) health[key] = row.n;
	}
	return health;
}

export interface ThreadCoverage {
	thread: string;
	coverage: 'strong' | 'thin' | 'missing';
	signalCount: number;
}

/**
 * Returns coverage per narrative thread for a topic based on pending gap
 * signals. Threads with no gap signals are inferred as "strong" (nothing flagged).
 * Threads flagged with gap + coverage=thin: "thin". gap + coverage=missing: "missing".
 *
 * Threads are read from the topic's narrativeThreads JSON.
 */
export async function threadCoverageByTopic(
	db: Database,
	topicId: string
): Promise<ThreadCoverage[]> {
	const { topics } = await import('../db/schema');
	const topicRows = await db.select().from(topics).where(eq(topics.id, topicId));
	const topic = topicRows[0];
	if (!topic) return [];
	const threadsJson = topic.narrativeThreads;
	const threads: string[] = threadsJson ? (JSON.parse(threadsJson) as string[]) : [];
	if (threads.length === 0) return [];

	const gapRows = await db
		.select()
		.from(signals)
		.where(
			and(
				eq(signals.topicId, topicId),
				eq(signals.signalType, 'gap'),
				eq(signals.status, 'pending')
			)
		);

	const byThread = new Map<string, { count: number; coverage: 'strong' | 'thin' | 'missing' }>();
	for (const row of gapRows) {
		const metadata = row.metadata
			? (JSON.parse(row.metadata) as { thread?: string; coverage?: 'thin' | 'missing' })
			: {};
		const thread = metadata.thread;
		if (!thread) continue;
		const coverage: 'thin' | 'missing' = metadata.coverage ?? 'thin';
		const existing = byThread.get(thread);
		if (!existing || (coverage === 'missing' && existing.coverage !== 'missing')) {
			byThread.set(thread, { count: (existing?.count ?? 0) + 1, coverage });
		} else {
			existing.count += 1;
		}
	}

	return threads.map((thread) => {
		const entry = byThread.get(thread);
		if (!entry) return { thread, coverage: 'strong', signalCount: 0 };
		return { thread, coverage: entry.coverage, signalCount: entry.count };
	});
}
