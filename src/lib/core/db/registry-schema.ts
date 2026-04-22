import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { Database } from './connection';

export const registryProjects = sqliteTable('projects', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	path: text('path').notNull(),
	config: text('config'), // JSON per-project overrides (Spec 3 §2.1)
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});

export async function initRegistryDb(db: Database): Promise<void> {
	await db.run(sql`CREATE TABLE IF NOT EXISTS projects (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		path TEXT NOT NULL,
		config TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`);
}
