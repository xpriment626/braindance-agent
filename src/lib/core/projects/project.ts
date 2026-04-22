import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { createDb, type Database } from '../db/connection';
import { initRegistryDb } from '../db/registry-schema';
import { initProjectDb } from '../db/schema';
import { generateId } from '../db/id';
import { createRegistryEntry, getRegistryEntry, deleteRegistryEntry } from './registry';

export interface ProjectHandle {
	id: string;
	name: string;
	path: string;
	db: Database;
}

export async function ensureDataDir(dataDir: string): Promise<void> {
	await mkdir(join(dataDir, 'projects'), { recursive: true });
}

export async function openRegistry(dataDir: string): Promise<Database> {
	await ensureDataDir(dataDir);
	const db = createDb(`file:${join(dataDir, 'registry.db')}`);
	await initRegistryDb(db);
	return db;
}

export async function createProject(
	dataDir: string,
	registryDb: Database,
	name: string
): Promise<ProjectHandle> {
	const id = generateId();
	const projectDir = join(dataDir, 'projects', id);

	// Create project directory structure
	await mkdir(join(projectDir, 'files'), { recursive: true });

	// Create and initialize project database
	const db = createDb(`file:${join(projectDir, 'braindance.db')}`);
	await initProjectDb(db);

	// Register in project index — path is relative to the data dir (Spec 3 §2).
	// Thread the same id into the registry so row id == directory name.
	await createRegistryEntry(registryDb, name, join('projects', id), id);

	return { id, name, path: projectDir, db };
}

export async function openProject(
	dataDir: string,
	registryDb: Database,
	id: string
): Promise<ProjectHandle | null> {
	const entry = await getRegistryEntry(registryDb, id);
	if (!entry) return null;

	const projectDir = join(dataDir, 'projects', id);
	const db = createDb(`file:${join(projectDir, 'braindance.db')}`);

	return { id, name: entry.name, path: projectDir, db };
}

export async function deleteProject(
	dataDir: string,
	registryDb: Database,
	id: string
): Promise<void> {
	const projectDir = join(dataDir, 'projects', id);
	await rm(projectDir, { recursive: true, force: true });
	await deleteRegistryEntry(registryDb, id);
}
