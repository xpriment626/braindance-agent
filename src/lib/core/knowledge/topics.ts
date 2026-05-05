import { eq } from 'drizzle-orm';
import {
	topics,
	seeds,
	sources,
	workflowRuns,
	agentRuns,
	discoveryReports,
	signals
} from '../db/schema';
import { generateId } from '../db/id';
import type { Database } from '../db/connection';

export interface Topic {
	id: string;
	name: string;
	description: string | null;
	guidance: string | null;
	narrativeThreads: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CreateTopicInput {
	name: string;
	description?: string;
	guidance?: string;
	narrativeThreads?: string[];
}

export interface UpdateTopicInput {
	name?: string;
	description?: string;
	guidance?: string;
	narrativeThreads?: string[];
}

export async function createTopic(db: Database, input: CreateTopicInput): Promise<Topic> {
	const now = new Date().toISOString();
	const record: Topic = {
		id: generateId(),
		name: input.name,
		description: input.description ?? null,
		guidance: input.guidance ?? null,
		narrativeThreads: input.narrativeThreads ? JSON.stringify(input.narrativeThreads) : null,
		createdAt: now,
		updatedAt: now
	};
	await db.insert(topics).values(record);
	return record;
}

export async function listTopics(db: Database): Promise<Topic[]> {
	return db.select().from(topics);
}

export async function getTopic(db: Database, id: string): Promise<Topic | null> {
	const results = await db.select().from(topics).where(eq(topics.id, id));
	return results[0] ?? null;
}

export async function updateTopic(
	db: Database,
	id: string,
	input: UpdateTopicInput
): Promise<void> {
	const now = new Date().toISOString();
	const patch: Record<string, unknown> = { updatedAt: now };
	if (input.name !== undefined) patch.name = input.name;
	if (input.description !== undefined) patch.description = input.description;
	if (input.guidance !== undefined) patch.guidance = input.guidance;
	if (input.narrativeThreads !== undefined) {
		patch.narrativeThreads = JSON.stringify(input.narrativeThreads);
	}
	await db.update(topics).set(patch).where(eq(topics.id, id));
}

export async function deleteTopic(db: Database, id: string): Promise<void> {
	await db.delete(topics).where(eq(topics.id, id));
}

export interface CascadeDeleteResult {
	// Relative source paths (e.g. "abc123/original.md") that the caller should
	// remove from the project's files/ directory after the DB transaction
	// commits. We collect these inside the same transaction that drops the
	// rows so the snapshot is consistent.
	removedSourcePaths: string[];
}

// Deletes a topic plus every row that references it across the 6 child
// tables (signals, discovery_reports, agent_runs, workflow_runs, sources,
// seeds). Filesystem cleanup is the caller's job — `removedSourcePaths`
// lists every source.raw_path that was attached to the topic so the caller
// can rm -rf the corresponding files/{sourceId}/ directories. We do FS
// cleanup outside the transaction to avoid mixing DB and FS atomicity:
// DB-first means a filesystem failure leaves orphan directories (no rows
// reference them — recoverable later) rather than broken raw_path pointers.
export async function deleteTopicCascade(
	db: Database,
	id: string
): Promise<CascadeDeleteResult> {
	const sourceRows = await db
		.select({ rawPath: sources.rawPath })
		.from(sources)
		.where(eq(sources.topicId, id));

	const removedSourcePaths = sourceRows
		.map((r) => r.rawPath)
		.filter((p): p is string => p !== null && p !== '');

	await db.transaction(async (tx) => {
		await tx.delete(signals).where(eq(signals.topicId, id));
		await tx.delete(discoveryReports).where(eq(discoveryReports.topicId, id));
		await tx.delete(agentRuns).where(eq(agentRuns.topicId, id));
		await tx.delete(workflowRuns).where(eq(workflowRuns.topicId, id));
		await tx.delete(sources).where(eq(sources.topicId, id));
		await tx.delete(seeds).where(eq(seeds.topicId, id));
		await tx.delete(topics).where(eq(topics.id, id));
	});

	return { removedSourcePaths };
}
