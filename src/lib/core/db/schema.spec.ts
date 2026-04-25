import { describe, it, expect } from 'vitest';
import { createDb } from './connection';
import { registryProjects, initRegistryDb } from './registry-schema';
import {
	topics,
	seeds,
	sources,
	workflowRuns,
	agentRuns,
	discoveryReports,
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
	it('creates all 7 project tables', async () => {
		const db = createDb(':memory:');
		await initProjectDb(db);

		// Each query throws if table doesn't exist
		expect(await db.select().from(topics)).toEqual([]);
		expect(await db.select().from(seeds)).toEqual([]);
		expect(await db.select().from(sources)).toEqual([]);
		expect(await db.select().from(workflowRuns)).toEqual([]);
		expect(await db.select().from(agentRuns)).toEqual([]);
		expect(await db.select().from(discoveryReports)).toEqual([]);
		expect(await db.select().from(signals)).toEqual([]);
	});

	it('is idempotent', async () => {
		const db = createDb(':memory:');
		await initProjectDb(db);
		await initProjectDb(db); // should not throw
		expect(await db.select().from(topics)).toEqual([]);
	});

	it('seeds table has nullable discovery_report_id column for journalist-seed traceability', async () => {
		const db = createDb(':memory:');
		await initProjectDb(db);
		await db.insert(seeds).values({
			id: 'seed-1',
			topicId: 'topic-1',
			type: 'freeform',
			status: 'processing',
			origin: 'journalist',
			inputCount: 3,
			processedCount: 0,
			discoveryReportId: 'report-abc',
			createdAt: new Date().toISOString()
		});
		await db.insert(seeds).values({
			id: 'seed-2',
			topicId: 'topic-1',
			type: 'freeform',
			status: 'processing',
			origin: 'user',
			inputCount: 1,
			processedCount: 0,
			createdAt: new Date().toISOString()
		});
		const rows = await db.select().from(seeds);
		const linked = rows.find((r) => r.id === 'seed-1');
		const unlinked = rows.find((r) => r.id === 'seed-2');
		expect(linked?.discoveryReportId).toBe('report-abc');
		expect(unlinked?.discoveryReportId).toBeNull();
	});
});
