import { eq, sql } from 'drizzle-orm';
import { seeds } from '../db/schema';
import { generateId } from '../db/id';
import type { Database } from '../db/connection';

export type SeedType = 'freeform' | 'briefing_card';
export type SeedOrigin = 'user' | 'journalist';
export type SeedStatus = 'processing' | 'ready' | 'partial' | 'failed';

export interface Seed {
	id: string;
	topicId: string;
	type: SeedType;
	status: SeedStatus;
	origin: SeedOrigin;
	inputCount: number;
	processedCount: number;
	failures: string | null;
	topicSnapshot: string | null;
	discoveryReportId: string | null;
	createdAt: string;
	completedAt: string | null;
}

export interface CreateSeedInput {
	topicId: string;
	type: SeedType;
	origin: SeedOrigin;
	inputCount: number;
	topicSnapshot?: Record<string, unknown>;
	discoveryReportId?: string;
}

export interface SeedFailure {
	inputIndex: number;
	type: string;
	error: string;
}

export async function createSeed(db: Database, input: CreateSeedInput): Promise<Seed> {
	const record: Seed = {
		id: generateId(),
		topicId: input.topicId,
		type: input.type,
		status: 'processing',
		origin: input.origin,
		inputCount: input.inputCount,
		processedCount: 0,
		failures: null,
		topicSnapshot: input.topicSnapshot ? JSON.stringify(input.topicSnapshot) : null,
		discoveryReportId: input.discoveryReportId ?? null,
		createdAt: new Date().toISOString(),
		completedAt: null
	};
	await db.insert(seeds).values(record);
	return record;
}

export async function getSeedByDiscoveryReport(
	db: Database,
	discoveryReportId: string
): Promise<Seed | null> {
	const results = await db
		.select()
		.from(seeds)
		.where(eq(seeds.discoveryReportId, discoveryReportId));
	return (results[0] as Seed | undefined) ?? null;
}

export async function deleteSeed(db: Database, id: string): Promise<void> {
	await db.delete(seeds).where(eq(seeds.id, id));
}

export async function getSeed(db: Database, id: string): Promise<Seed | null> {
	const results = await db.select().from(seeds).where(eq(seeds.id, id));
	return (results[0] as Seed | undefined) ?? null;
}

export async function incrementProcessedCount(db: Database, seedId: string): Promise<void> {
	await db
		.update(seeds)
		.set({ processedCount: sql`processed_count + 1` })
		.where(eq(seeds.id, seedId));
}

export async function completeSeed(
	db: Database,
	seedId: string,
	failures?: SeedFailure[]
): Promise<void> {
	const seed = await getSeed(db, seedId);
	if (!seed) throw new Error(`Seed not found: ${seedId}`);

	const hasFailures = failures !== undefined && failures.length > 0;
	let status: SeedStatus;
	if (!hasFailures) {
		status = 'ready';
	} else if (seed.processedCount === 0 && failures!.length === seed.inputCount) {
		status = 'failed';
	} else {
		status = 'partial';
	}

	await db
		.update(seeds)
		.set({
			status,
			failures: hasFailures ? JSON.stringify(failures) : null,
			completedAt: new Date().toISOString()
		})
		.where(eq(seeds.id, seedId));
}
