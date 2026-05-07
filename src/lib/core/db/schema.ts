import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { Database } from './connection';

// ─── Topics ───────────────────────────────────────────────
export const topics = sqliteTable('topics', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	description: text('description'),
	guidance: text('guidance'),
	narrativeThreads: text('narrative_threads'), // JSON string[]
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});

// ─── Seeds ────────────────────────────────────────────────
export const seeds = sqliteTable('seeds', {
	id: text('id').primaryKey(),
	topicId: text('topic_id').notNull(),
	type: text('type').notNull(), // "freeform" | "briefing_card"
	status: text('status').notNull(), // "processing" | "ready" | "partial" | "failed"
	origin: text('origin').notNull(), // "user" | "journalist"
	inputCount: integer('input_count').notNull(),
	processedCount: integer('processed_count').notNull().default(0),
	failures: text('failures'), // JSON { input_index, type, error }[]
	topicSnapshot: text('topic_snapshot'), // JSON topic metadata snapshot
	discoveryReportId: text('discovery_report_id'), // nullable; links journalist-origin seeds to their discovery report
	createdAt: text('created_at').notNull(),
	completedAt: text('completed_at')
});

// ─── Sources ──────────────────────────────────────────────
export const sources = sqliteTable('sources', {
	id: text('id').primaryKey(),
	seedId: text('seed_id').notNull(),
	topicId: text('topic_id').notNull(), // denormalized from seed
	title: text('title').notNull(),
	type: text('type').notNull(), // "file" | "url" | "youtube" | "tweet" | "image" | "text"
	originalUrl: text('original_url'),
	originalFormat: text('original_format'),
	content: text('content'),
	rawPath: text('raw_path'),
	provenance: text('provenance'),
	metadata: text('metadata'), // JSON format-specific metadata
	createdAt: text('created_at').notNull()
});

// ─── Workflow Runs ────────────────────────────────────────
export const workflowRuns = sqliteTable('workflow_runs', {
	id: text('id').primaryKey(),
	type: text('type').notNull(), // "add_knowledge" | "audit_corpus" | "prune_corpus"
	topicId: text('topic_id').notNull(),
	status: text('status').notNull(), // "running" | "staged" | "completed" | "failed"
	config: text('config'), // JSON workflow config
	startedAt: text('started_at').notNull(),
	completedAt: text('completed_at'),
	error: text('error')
});

// ─── Agent Runs ───────────────────────────────────────────
export const agentRuns = sqliteTable('agent_runs', {
	id: text('id').primaryKey(),
	agentType: text('agent_type').notNull(), // "discover" | "audit" | "prune"
	topicId: text('topic_id').notNull(),
	workflowRunId: text('workflow_run_id'), // nullable for free-composition runs
	status: text('status').notNull(), // "running" | "completed" | "failed"
	config: text('config'), // JSON agent config
	startedAt: text('started_at').notNull(),
	completedAt: text('completed_at'),
	error: text('error')
});

// ─── Discovery Reports ────────────────────────────────────
export const discoveryReports = sqliteTable('discovery_reports', {
	id: text('id').primaryKey(),
	topicId: text('topic_id').notNull(),
	workflowRunId: text('workflow_run_id').notNull(),
	status: text('status').notNull(), // "pending" | "reviewed" | "dismissed"
	summary: text('summary'),
	newSources: text('new_sources'), // JSON discovered sources array
	auditFindings: text('audit_findings'), // JSON audit output
	createdAt: text('created_at').notNull(),
	reviewedAt: text('reviewed_at')
});

// ─── Signals ──────────────────────────────────────────────
export const signals = sqliteTable('signals', {
	id: text('id').primaryKey(),
	topicId: text('topic_id').notNull(),
	// Nullable FK → discovery_reports.id. Set for signals raised by the audit
	// step inside add_knowledge runs (so Signal Review can scope by report).
	// Null for audit_corpus standalone runs (no parent report) and for any
	// pre-Phase-B signals the backfill couldn't pin via the workflow_run chain
	// — those surface only in the KB-wide Maintenance flow.
	discoveryReportId: text('discovery_report_id'),
	targetType: text('target_type').notNull(), // "source" | "thread"
	targetId: text('target_id').notNull(),
	signalType: text('signal_type').notNull(), // "fresh" | "contested" | "stale" | "retracted" | "gap" | "consolidation"
	reason: text('reason'),
	raisedBy: text('raised_by').notNull(), // "audit" | "user"
	status: text('status').notNull(), // "pending" | "approved" | "applied" | "dismissed"
	metadata: text('metadata'), // JSON signal-type-specific data
	createdAt: text('created_at').notNull(),
	resolvedAt: text('resolved_at')
});

// ─── Schema initialization ───────────────────────────────

export async function initProjectDb(db: Database): Promise<void> {
	await db.run(sql`CREATE TABLE IF NOT EXISTS topics (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		description TEXT,
		guidance TEXT,
		narrative_threads TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`);

	await db.run(sql`CREATE TABLE IF NOT EXISTS seeds (
		id TEXT PRIMARY KEY,
		topic_id TEXT NOT NULL,
		type TEXT NOT NULL,
		status TEXT NOT NULL,
		origin TEXT NOT NULL,
		input_count INTEGER NOT NULL,
		processed_count INTEGER NOT NULL DEFAULT 0,
		failures TEXT,
		topic_snapshot TEXT,
		discovery_report_id TEXT,
		created_at TEXT NOT NULL,
		completed_at TEXT
	)`);

	await db.run(sql`CREATE TABLE IF NOT EXISTS sources (
		id TEXT PRIMARY KEY,
		seed_id TEXT NOT NULL,
		topic_id TEXT NOT NULL,
		title TEXT NOT NULL,
		type TEXT NOT NULL,
		original_url TEXT,
		original_format TEXT,
		content TEXT,
		raw_path TEXT,
		provenance TEXT,
		metadata TEXT,
		created_at TEXT NOT NULL
	)`);

	await db.run(sql`CREATE TABLE IF NOT EXISTS workflow_runs (
		id TEXT PRIMARY KEY,
		type TEXT NOT NULL,
		topic_id TEXT NOT NULL,
		status TEXT NOT NULL,
		config TEXT,
		started_at TEXT NOT NULL,
		completed_at TEXT,
		error TEXT
	)`);

	await db.run(sql`CREATE TABLE IF NOT EXISTS agent_runs (
		id TEXT PRIMARY KEY,
		agent_type TEXT NOT NULL,
		topic_id TEXT NOT NULL,
		workflow_run_id TEXT,
		status TEXT NOT NULL,
		config TEXT,
		started_at TEXT NOT NULL,
		completed_at TEXT,
		error TEXT
	)`);

	await db.run(sql`CREATE TABLE IF NOT EXISTS discovery_reports (
		id TEXT PRIMARY KEY,
		topic_id TEXT NOT NULL,
		workflow_run_id TEXT NOT NULL,
		status TEXT NOT NULL,
		summary TEXT,
		new_sources TEXT,
		audit_findings TEXT,
		created_at TEXT NOT NULL,
		reviewed_at TEXT
	)`);

	await db.run(sql`CREATE TABLE IF NOT EXISTS signals (
		id TEXT PRIMARY KEY,
		topic_id TEXT NOT NULL,
		discovery_report_id TEXT,
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

	// Forward-only migration for DBs created before signals.discovery_report_id
	// existed. SQLite has no `ADD COLUMN IF NOT EXISTS`, so we probe pragma_table_info.
	await addColumnIfMissing(db, 'signals', 'discovery_report_id', 'TEXT');

	// Backfill: pin existing audit-raised signals to their parent discovery_report
	// via the `workflow_run_id` chain. Bounds to the audit agent_run's time window
	// so a signal can't be assigned to a report from a different run that happens
	// to share the topic. Idempotent — only updates rows where the FK is still null.
	await db.run(sql`
		UPDATE signals
		SET discovery_report_id = (
			SELECT dr.id
			FROM discovery_reports dr
			JOIN agent_runs ar
				ON ar.workflow_run_id = dr.workflow_run_id
				AND ar.agent_type = 'audit'
				AND ar.topic_id = dr.topic_id
			WHERE dr.topic_id = signals.topic_id
				AND signals.created_at >= ar.started_at
				AND (
					ar.completed_at IS NULL
					OR signals.created_at <= ar.completed_at
				)
			LIMIT 1
		)
		WHERE signals.discovery_report_id IS NULL
			AND signals.raised_by = 'audit'
	`);
}

// ─── Migration helpers ────────────────────────────────────

/**
 * Idempotent `ALTER TABLE … ADD COLUMN`. SQLite/libSQL doesn't support
 * `IF NOT EXISTS` on ADD COLUMN, so we probe pragma_table_info first.
 */
async function addColumnIfMissing(
	db: Database,
	table: string,
	column: string,
	sqlType: string
): Promise<void> {
	const result = await db.run(
		sql.raw(`SELECT name FROM pragma_table_info('${table}') WHERE name = '${column}'`)
	);
	if (result.rows.length > 0) return;
	await db.run(sql.raw(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlType}`));
}
