import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, type Database } from '../../db/connection';
import { initRegistryDb } from '../../db/registry-schema';
import { createRegistryEntry } from '../../projects/registry';
import { openRegistry, createProject } from '../../projects/project';
import { createTopic } from '../../knowledge/topics';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listProjectsHandler } from './listProjects';
import { listTopicsHandler } from './listTopics';

describe('list_projects tool', () => {
	let registryDb: Database;

	beforeEach(async () => {
		registryDb = createDb(':memory:');
		await initRegistryDb(registryDb);
	});

	it('returns empty array when no projects', async () => {
		const result = await listProjectsHandler({ registryDb });
		expect(result).toEqual([]);
	});

	it('returns registered projects with id, name, created_at and hides the path', async () => {
		await createRegistryEntry(registryDb, 'Project A', 'projects/a');
		await createRegistryEntry(registryDb, 'Project B', 'projects/b');
		const result = await listProjectsHandler({ registryDb });
		expect(result).toHaveLength(2);
		const first = result[0];
		expect(first).toHaveProperty('id');
		expect(first).toHaveProperty('name');
		expect(first).toHaveProperty('created_at');
		expect(first).not.toHaveProperty('path');
	});
});

describe('list_topics tool', () => {
	let dataDir: string;
	let registryDb: Database;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), 'bd-mcp-topics-'));
		registryDb = await openRegistry(dataDir);
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	it('throws on unknown project_id', async () => {
		await expect(
			listTopicsHandler({ dataDir, registryDb, projectId: 'nonexistent' })
		).rejects.toThrow(/project not found/i);
	});

	it('returns empty array for project with no topics', async () => {
		const project = await createProject(dataDir, registryDb, 'Empty Project');
		const result = await listTopicsHandler({
			dataDir,
			registryDb,
			projectId: project.id
		});
		expect(result).toEqual([]);
	});

	it('returns topics with id/name/description/narrative_threads', async () => {
		const project = await createProject(dataDir, registryDb, 'P1');
		await createTopic(project.db, {
			name: 'HCI',
			description: 'human-computer interaction',
			narrativeThreads: ['agent paradigm', 'skeuomorphism']
		});
		const result = await listTopicsHandler({
			dataDir,
			registryDb,
			projectId: project.id
		});
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('HCI');
		expect(result[0].description).toBe('human-computer interaction');
		expect(result[0].narrative_threads).toEqual(['agent paradigm', 'skeuomorphism']);
	});

	it('defaults narrative_threads to [] when not set on the topic', async () => {
		const project = await createProject(dataDir, registryDb, 'P2');
		await createTopic(project.db, { name: 'No threads' });
		const result = await listTopicsHandler({
			dataDir,
			registryDb,
			projectId: project.id
		});
		expect(result[0].narrative_threads).toEqual([]);
	});
});
