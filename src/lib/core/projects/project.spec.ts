import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, access, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { topics } from '../db/schema';
import { listRegistryEntries } from './registry';
import {
	ensureDataDir,
	openRegistry,
	createProject,
	openProject,
	deleteProject
} from './project';

describe('project lifecycle', () => {
	let testDataDir: string;

	beforeEach(async () => {
		testDataDir = await mkdtemp(join(tmpdir(), 'braindance-test-'));
	});

	afterEach(async () => {
		await rm(testDataDir, { recursive: true, force: true });
	});

	describe('ensureDataDir', () => {
		it('creates data/projects/ directory structure', async () => {
			await ensureDataDir(testDataDir);
			const entries = await readdir(testDataDir);
			expect(entries).toContain('projects');
		});

		it('is idempotent', async () => {
			await ensureDataDir(testDataDir);
			await expect(ensureDataDir(testDataDir)).resolves.toBeUndefined();
		});
	});

	describe('openRegistry', () => {
		it('creates and initializes registry database', async () => {
			const registryDb = await openRegistry(testDataDir);
			// Should be able to query the projects table
			const entries = await listRegistryEntries(registryDb);
			expect(entries).toEqual([]);
		});
	});

	describe('createProject', () => {
		it('creates project directory with files/ subdirectory', async () => {
			const registryDb = await openRegistry(testDataDir);
			const project = await createProject(testDataDir, registryDb, 'Test Project');

			const projectDir = join(testDataDir, 'projects', project.id);
			await expect(access(projectDir)).resolves.toBeUndefined();
			await expect(access(join(projectDir, 'files'))).resolves.toBeUndefined();
		});

		it('creates an initialized project database', async () => {
			const registryDb = await openRegistry(testDataDir);
			const project = await createProject(testDataDir, registryDb, 'Test Project');

			// Project DB should have all tables — verify by querying one
			const result = await project.db.select().from(topics);
			expect(result).toEqual([]);
		});

		it('registers the project in the registry', async () => {
			const registryDb = await openRegistry(testDataDir);
			await createProject(testDataDir, registryDb, 'Test Project');

			const entries = await listRegistryEntries(registryDb);
			expect(entries).toHaveLength(1);
			expect(entries[0].name).toBe('Test Project');
		});

		it('returns a ProjectHandle with id, name, path, and db', async () => {
			const registryDb = await openRegistry(testDataDir);
			const project = await createProject(testDataDir, registryDb, 'Test Project');

			expect(project.id).toHaveLength(26);
			expect(project.name).toBe('Test Project');
			expect(project.path).toContain(project.id);
			expect(project.db).toBeDefined();
		});
	});

	describe('openProject', () => {
		it('opens an existing project and returns a handle', async () => {
			const registryDb = await openRegistry(testDataDir);
			const created = await createProject(testDataDir, registryDb, 'Test Project');

			const opened = await openProject(testDataDir, registryDb, created.id);
			expect(opened).not.toBeNull();
			expect(opened!.id).toBe(created.id);
			expect(opened!.name).toBe('Test Project');
		});

		it('returns null for unknown project id', async () => {
			const registryDb = await openRegistry(testDataDir);
			const opened = await openProject(testDataDir, registryDb, 'nonexistent');
			expect(opened).toBeNull();
		});
	});

	describe('deleteProject', () => {
		it('removes the project directory', async () => {
			const registryDb = await openRegistry(testDataDir);
			const project = await createProject(testDataDir, registryDb, 'Test Project');
			await deleteProject(testDataDir, registryDb, project.id);

			const exists = await access(project.path)
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(false);
		});

		it('removes the registry entry', async () => {
			const registryDb = await openRegistry(testDataDir);
			const project = await createProject(testDataDir, registryDb, 'Test Project');
			await deleteProject(testDataDir, registryDb, project.id);

			const entries = await listRegistryEntries(registryDb);
			expect(entries).toHaveLength(0);
		});
	});
});
