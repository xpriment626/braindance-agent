import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb, type Database } from '../../db/connection';
import { initRegistryDb } from '../../db/registry-schema';
import { createRegistryEntry } from '../../projects/registry';
import { openRegistry, createProject, openProject } from '../../projects/project';
import { createTopic } from '../../knowledge/topics';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSeed } from '../../knowledge/seeds';
import { createSource } from '../../knowledge/sources';
import { generateId } from '../../db/id';
import { listProjectsHandler } from './listProjects';
import { listTopicsHandler } from './listTopics';
import { readKbHandler } from './readKb';

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

describe('read_kb tool', () => {
	let dataDir: string;
	let registryDb: Database;
	let projectId: string;
	let topicId: string;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), 'bd-mcp-readkb-'));
		registryDb = await openRegistry(dataDir);
		const project = await createProject(dataDir, registryDb, 'Test');
		projectId = project.id;
		const topic = await createTopic(project.db, { name: 'T1' });
		topicId = topic.id;

		const seed = await createSeed(project.db, {
			topicId,
			type: 'freeform',
			origin: 'user',
			inputCount: 1
		});
		await createSource(project.db, {
			id: generateId(),
			seedId: seed.id,
			topicId,
			title: 'Long Article',
			type: 'text',
			content: 'A'.repeat(2000),
			originalFormat: 'text/plain',
			provenance: 'user paste'
		});
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	it('returns full content by default', async () => {
		const result = await readKbHandler({ dataDir, registryDb, projectId });
		expect(result).toHaveLength(1);
		expect(result[0].content?.length).toBe(2000);
	});

	it('truncates to ~300 chars in summary mode', async () => {
		const result = await readKbHandler({
			dataDir,
			registryDb,
			projectId,
			contentMode: 'summary'
		});
		expect(result[0].content?.length).toBeLessThanOrEqual(300);
	});

	it('omits content entirely in none mode', async () => {
		const result = await readKbHandler({
			dataDir,
			registryDb,
			projectId,
			contentMode: 'none'
		});
		expect(result[0].content).toBeUndefined();
		expect(result[0].title).toBe('Long Article');
	});

	it('filters by topic_id when provided', async () => {
		const scoped = await readKbHandler({ dataDir, registryDb, projectId, topicId });
		expect(scoped).toHaveLength(1);
		const empty = await readKbHandler({
			dataDir,
			registryDb,
			projectId,
			topicId: 'no-such-topic'
		});
		expect(empty).toHaveLength(0);
	});

	it('respects limit param', async () => {
		const project = await openProject(dataDir, registryDb, projectId);
		if (!project) throw new Error('project vanished');
		for (let i = 0; i < 4; i++) {
			const seed = await createSeed(project.db, {
				topicId,
				type: 'freeform',
				origin: 'user',
				inputCount: 1
			});
			await createSource(project.db, {
				id: generateId(),
				seedId: seed.id,
				topicId,
				title: `Article ${i}`,
				type: 'text',
				content: 'x',
				originalFormat: 'text/plain'
			});
		}
		const limited = await readKbHandler({
			dataDir,
			registryDb,
			projectId,
			limit: 2
		});
		expect(limited).toHaveLength(2);
	});

	it('throws on unknown project_id', async () => {
		await expect(
			readKbHandler({ dataDir, registryDb, projectId: 'nope' })
		).rejects.toThrow(/project not found/i);
	});
});
