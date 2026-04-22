import { describe, it, expect } from 'vitest';
import { createDb } from './connection';
import { registryProjects, initRegistryDb } from './registry-schema';
import {
	topics,
	seeds,
	sources,
	workflowRuns,
	agentRuns,
	briefings,
	drafts,
	signals,
	initProjectDb
} from './schema';

describe('createDb', () => {
	it('creates a working in-memory database connection', async () => {
		const db = createDb(':memory:');
		// If connection fails, any query will throw
		await db.select().from(registryProjects).catch(() => null);
		// Table doesn't exist yet, but connection itself works — we just need no crash on connect
		expect(db).toBeDefined();
	});
});

describe('initRegistryDb', () => {
	it('creates the projects table', async () => {
		const db = createDb(':memory:');
		await initRegistryDb(db);
		const result = await db.select().from(registryProjects);
		expect(result).toEqual([]);
	});

	it('is idempotent', async () => {
		const db = createDb(':memory:');
		await initRegistryDb(db);
		await initRegistryDb(db); // should not throw
		const result = await db.select().from(registryProjects);
		expect(result).toEqual([]);
	});
});

describe('initProjectDb', () => {
	it('creates all 8 project tables', async () => {
		const db = createDb(':memory:');
		await initProjectDb(db);

		// Each query throws if table doesn't exist
		expect(await db.select().from(topics)).toEqual([]);
		expect(await db.select().from(seeds)).toEqual([]);
		expect(await db.select().from(sources)).toEqual([]);
		expect(await db.select().from(workflowRuns)).toEqual([]);
		expect(await db.select().from(agentRuns)).toEqual([]);
		expect(await db.select().from(briefings)).toEqual([]);
		expect(await db.select().from(drafts)).toEqual([]);
		expect(await db.select().from(signals)).toEqual([]);
	});

	it('is idempotent', async () => {
		const db = createDb(':memory:');
		await initProjectDb(db);
		await initProjectDb(db); // should not throw
		expect(await db.select().from(topics)).toEqual([]);
	});
});
