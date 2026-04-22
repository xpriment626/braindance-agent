import { eq } from 'drizzle-orm';
import { topics } from '../db/schema';
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
