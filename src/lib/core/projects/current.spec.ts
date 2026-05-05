import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { openRegistry, createProject } from './project';
import { getCurrentProject } from './current';

const cookieJar = (entries: Record<string, string> = {}) => ({
	get: (name: string) => entries[name]
});

describe('getCurrentProject', () => {
	let testDataDir: string;
	let prevDataDir: string | undefined;
	let prevProjectId: string | undefined;

	beforeEach(async () => {
		testDataDir = await mkdtemp(join(tmpdir(), 'bd-current-'));
		prevDataDir = process.env.BRAINDANCE_DATA_DIR;
		prevProjectId = process.env.BRAINDANCE_PROJECT_ID;
		process.env.BRAINDANCE_DATA_DIR = testDataDir;
		delete process.env.BRAINDANCE_PROJECT_ID;
	});

	afterEach(async () => {
		await rm(testDataDir, { recursive: true, force: true });
		if (prevDataDir === undefined) delete process.env.BRAINDANCE_DATA_DIR;
		else process.env.BRAINDANCE_DATA_DIR = prevDataDir;
		if (prevProjectId === undefined) delete process.env.BRAINDANCE_PROJECT_ID;
		else process.env.BRAINDANCE_PROJECT_ID = prevProjectId;
	});

	it('returns null handle when registry is empty', async () => {
		const result = await getCurrentProject();
		expect(result.handle).toBeNull();
		expect(result.availableProjects).toEqual([]);
	});

	it('falls back to first registry entry when no cookie or env pin', async () => {
		const registry = await openRegistry(testDataDir);
		const a = await createProject(testDataDir, registry, 'A');
		await createProject(testDataDir, registry, 'B');

		const result = await getCurrentProject();
		expect(result.handle?.id).toBe(a.id);
		expect(result.availableProjects).toHaveLength(2);
	});

	it('honors a valid cookie pin over env / first', async () => {
		const registry = await openRegistry(testDataDir);
		const a = await createProject(testDataDir, registry, 'A');
		const b = await createProject(testDataDir, registry, 'B');
		process.env.BRAINDANCE_PROJECT_ID = a.id;

		const result = await getCurrentProject(cookieJar({ braindance_project_id: b.id }));
		expect(result.handle?.id).toBe(b.id);
	});

	it('ignores a stale cookie (project no longer exists) and falls through', async () => {
		const registry = await openRegistry(testDataDir);
		const a = await createProject(testDataDir, registry, 'A');

		const result = await getCurrentProject(
			cookieJar({ braindance_project_id: '01STALE0000000000000000000' })
		);
		expect(result.handle?.id).toBe(a.id);
	});

	it('honors env pin when cookie is absent', async () => {
		const registry = await openRegistry(testDataDir);
		await createProject(testDataDir, registry, 'A');
		const b = await createProject(testDataDir, registry, 'B');
		process.env.BRAINDANCE_PROJECT_ID = b.id;

		const result = await getCurrentProject();
		expect(result.handle?.id).toBe(b.id);
	});

	it('falls through when env pin is invalid', async () => {
		const registry = await openRegistry(testDataDir);
		const a = await createProject(testDataDir, registry, 'A');
		process.env.BRAINDANCE_PROJECT_ID = '01STALE0000000000000000000';

		const result = await getCurrentProject();
		expect(result.handle?.id).toBe(a.id);
	});

	it('cookie wins even when no env pin is set', async () => {
		const registry = await openRegistry(testDataDir);
		await createProject(testDataDir, registry, 'A');
		const b = await createProject(testDataDir, registry, 'B');

		const result = await getCurrentProject(cookieJar({ braindance_project_id: b.id }));
		expect(result.handle?.id).toBe(b.id);
	});
});
