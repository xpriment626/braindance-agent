import { eq } from 'drizzle-orm';
import { registryProjects } from '../db/registry-schema';
import { generateId } from '../db/id';
import type { Database } from '../db/connection';

export interface RegistryEntry {
	id: string;
	name: string;
	path: string;
	config: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface UpdateRegistryEntryInput {
	name?: string;
	config?: string | null;
}

export async function createRegistryEntry(
	db: Database,
	name: string,
	path: string,
	id?: string
): Promise<RegistryEntry> {
	const now = new Date().toISOString();
	const entry: RegistryEntry = {
		id: id ?? generateId(),
		name,
		path,
		config: null,
		createdAt: now,
		updatedAt: now
	};
	await db.insert(registryProjects).values(entry);
	return entry;
}

export async function listRegistryEntries(db: Database): Promise<RegistryEntry[]> {
	return db.select().from(registryProjects);
}

export async function getRegistryEntry(db: Database, id: string): Promise<RegistryEntry | null> {
	const results = await db.select().from(registryProjects).where(eq(registryProjects.id, id));
	return results[0] ?? null;
}

export async function updateRegistryEntry(
	db: Database,
	id: string,
	updates: UpdateRegistryEntryInput
): Promise<void> {
	const now = new Date().toISOString();
	const patch: Record<string, unknown> = { updatedAt: now };
	if (updates.name !== undefined) patch.name = updates.name;
	if (updates.config !== undefined) patch.config = updates.config;
	await db.update(registryProjects).set(patch).where(eq(registryProjects.id, id));
}

export async function deleteRegistryEntry(db: Database, id: string): Promise<void> {
	await db.delete(registryProjects).where(eq(registryProjects.id, id));
}
