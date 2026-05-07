import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
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

	it('signals table has nullable discovery_report_id column for per-report scoping', async () => {
		const db = createDb(':memory:');
		await initProjectDb(db);
		await db.insert(signals).values({
			id: 'sig-1',
			topicId: 'topic-1',
			discoveryReportId: 'report-xyz',
			targetType: 'source',
			targetId: 'src-1',
			signalType: 'stale',
			raisedBy: 'audit',
			status: 'pending',
			createdAt: new Date().toISOString()
		});
		await db.insert(signals).values({
			id: 'sig-2',
			topicId: 'topic-1',
			targetType: 'source',
			targetId: 'src-2',
			signalType: 'gap',
			raisedBy: 'audit',
			status: 'pending',
			createdAt: new Date().toISOString()
		});
		const rows = await db.select().from(signals);
		const linked = rows.find((r) => r.id === 'sig-1');
		const orphan = rows.find((r) => r.id === 'sig-2');
		expect(linked?.discoveryReportId).toBe('report-xyz');
		expect(orphan?.discoveryReportId).toBeNull();
	});
});

describe('signals.discovery_report_id migration', () => {
	it('adds the column to a pre-existing signals table that lacks it', async () => {
		const db = createDb(':memory:');
		// Simulate a pre-Phase-B DB by creating signals WITHOUT the new column.
		await db.run(sql`CREATE TABLE signals (
			id TEXT PRIMARY KEY,
			topic_id TEXT NOT NULL,
			target_type TEXT NOT NULL,
			target_id TEXT NOT NULL,
			signal_type TEXT NOT NULL,
			reason TEXT,
			raised_by TEXT NOT NULL,
			status TEXT NOT NULL,
			metadata TEXT,
			created_at TEXT NOT NULL,
			resolved_at TEXT
		)`);

		await initProjectDb(db);

		// Column should now exist.
		const cols = await db.run(sql`SELECT name FROM pragma_table_info('signals')`);
		const colNames = cols.rows.map((r) => (r as unknown as { name: string }).name);
		expect(colNames).toContain('discovery_report_id');
	});

	it('backfills existing audit signals via the workflow_run chain', async () => {
		const db = createDb(':memory:');

		// Build a pre-Phase-B-shaped DB: signals table without the new column.
		await db.run(sql`CREATE TABLE signals (
			id TEXT PRIMARY KEY,
			topic_id TEXT NOT NULL,
			target_type TEXT NOT NULL,
			target_id TEXT NOT NULL,
			signal_type TEXT NOT NULL,
			reason TEXT,
			raised_by TEXT NOT NULL,
			status TEXT NOT NULL,
			metadata TEXT,
			created_at TEXT NOT NULL,
			resolved_at TEXT
		)`);
		// Tables backfill needs to read.
		await db.run(sql`CREATE TABLE workflow_runs (
			id TEXT PRIMARY KEY, type TEXT NOT NULL, topic_id TEXT NOT NULL,
			status TEXT NOT NULL, config TEXT, started_at TEXT NOT NULL,
			completed_at TEXT, error TEXT
		)`);
		await db.run(sql`CREATE TABLE agent_runs (
			id TEXT PRIMARY KEY, agent_type TEXT NOT NULL, topic_id TEXT NOT NULL,
			workflow_run_id TEXT, status TEXT NOT NULL, config TEXT,
			started_at TEXT NOT NULL, completed_at TEXT, error TEXT
		)`);
		await db.run(sql`CREATE TABLE discovery_reports (
			id TEXT PRIMARY KEY, topic_id TEXT NOT NULL, workflow_run_id TEXT NOT NULL,
			status TEXT NOT NULL, summary TEXT, new_sources TEXT, audit_findings TEXT,
			created_at TEXT NOT NULL, reviewed_at TEXT
		)`);

		// Synthetic chain: workflow_run W1 → audit agent_run A1 → report R1.
		// Signal SIG-IN created during the audit window — should backfill to R1.
		// Signal SIG-OUT created outside the window — should stay null.
		// Signal SIG-USER raised by 'user' (not 'audit') — should stay null.
		const start = '2026-05-01T10:00:00.000Z';
		const end = '2026-05-01T10:05:00.000Z';
		const inWindow = '2026-05-01T10:02:00.000Z';
		const outOfWindow = '2026-05-01T11:00:00.000Z';

		await db.run(sql`INSERT INTO workflow_runs VALUES (
			'W1','add_knowledge','topic-1','staged',NULL,${start},${end},NULL
		)`);
		await db.run(sql`INSERT INTO agent_runs VALUES (
			'A1','audit','topic-1','W1','completed',NULL,${start},${end},NULL
		)`);
		await db.run(sql`INSERT INTO discovery_reports VALUES (
			'R1','topic-1','W1','pending',NULL,'[]','{}',${start},NULL
		)`);
		await db.run(sql`INSERT INTO signals (
			id, topic_id, target_type, target_id, signal_type, raised_by, status, created_at
		) VALUES
			('SIG-IN','topic-1','source','src-1','stale','audit','pending',${inWindow}),
			('SIG-OUT','topic-1','source','src-2','stale','audit','pending',${outOfWindow}),
			('SIG-USER','topic-1','source','src-3','contested','user','pending',${inWindow})
		`);

		// Run the migration + backfill.
		await initProjectDb(db);

		const rows = await db.select().from(signals);
		const sigIn = rows.find((r) => r.id === 'SIG-IN');
		const sigOut = rows.find((r) => r.id === 'SIG-OUT');
		const sigUser = rows.find((r) => r.id === 'SIG-USER');
		expect(sigIn?.discoveryReportId).toBe('R1');
		expect(sigOut?.discoveryReportId).toBeNull();
		expect(sigUser?.discoveryReportId).toBeNull();
	});

	it('is idempotent — re-running initProjectDb does not flip already-pinned FKs', async () => {
		const db = createDb(':memory:');
		await initProjectDb(db);
		await db.insert(signals).values({
			id: 'sig-stable',
			topicId: 'topic-1',
			discoveryReportId: 'report-stable',
			targetType: 'source',
			targetId: 'src-1',
			signalType: 'stale',
			raisedBy: 'audit',
			status: 'pending',
			createdAt: new Date().toISOString()
		});
		// Second init should be a no-op for this row's FK.
		await initProjectDb(db);
		const rows = await db.select().from(signals);
		expect(rows[0].discoveryReportId).toBe('report-stable');
	});
});
