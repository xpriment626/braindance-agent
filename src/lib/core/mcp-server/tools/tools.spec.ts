import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type Database } from '../../db/connection';
import { initRegistryDb } from '../../db/registry-schema';
import { createRegistryEntry } from '../../projects/registry';
import { listProjectsHandler } from './listProjects';

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
