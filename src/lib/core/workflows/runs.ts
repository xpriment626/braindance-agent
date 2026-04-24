import { eq } from 'drizzle-orm';
import { workflowRuns } from '../db/schema';
import { generateId } from '../db/id';
import type { Database } from '../db/connection';

export type WorkflowType = 'add_knowledge' | 'audit_corpus' | 'prune_corpus';
export type WorkflowStatus = 'running' | 'staged' | 'completed' | 'failed';

export interface WorkflowRun {
	id: string;
	type: WorkflowType;
	topicId: string;
	status: WorkflowStatus;
	config: Record<string, unknown> | null;
	startedAt: string;
	completedAt: string | null;
	error: string | null;
}

export interface CreateWorkflowRunInput {
	type: WorkflowType;
	topicId: string;
	config: Record<string, unknown> | null;
}

interface WorkflowRunRow {
	id: string;
	type: string;
	topicId: string;
	status: string;
	config: string | null;
	startedAt: string;
	completedAt: string | null;
	error: string | null;
}

function fromRow(row: WorkflowRunRow): WorkflowRun {
	return {
		id: row.id,
		type: row.type as WorkflowType,
		topicId: row.topicId,
		status: row.status as WorkflowStatus,
		config: row.config ? (JSON.parse(row.config) as Record<string, unknown>) : null,
		startedAt: row.startedAt,
		completedAt: row.completedAt,
		error: row.error
	};
}

export async function createWorkflowRun(
	db: Database,
	input: CreateWorkflowRunInput
): Promise<WorkflowRun> {
	const row: WorkflowRunRow = {
		id: generateId(),
		type: input.type,
		topicId: input.topicId,
		status: 'running',
		config: input.config ? JSON.stringify(input.config) : null,
		startedAt: new Date().toISOString(),
		completedAt: null,
		error: null
	};
	await db.insert(workflowRuns).values(row);
	return fromRow(row);
}

export async function getWorkflowRun(db: Database, id: string): Promise<WorkflowRun | null> {
	const results = (await db
		.select()
		.from(workflowRuns)
		.where(eq(workflowRuns.id, id))) as WorkflowRunRow[];
	return results[0] ? fromRow(results[0]) : null;
}

export async function listWorkflowRunsByTopic(
	db: Database,
	topicId: string
): Promise<WorkflowRun[]> {
	const rows = (await db
		.select()
		.from(workflowRuns)
		.where(eq(workflowRuns.topicId, topicId))) as WorkflowRunRow[];
	return rows.map(fromRow);
}

async function requireStatus(
	db: Database,
	id: string,
	allowed: WorkflowStatus[]
): Promise<WorkflowRun> {
	const existing = await getWorkflowRun(db, id);
	if (!existing) throw new Error(`workflow_run "${id}" not found`);
	if (!allowed.includes(existing.status)) {
		throw new Error(
			`workflow_run "${id}" is ${existing.status}, expected one of [${allowed.join(', ')}]`
		);
	}
	return existing;
}

export async function stageWorkflowRun(db: Database, id: string): Promise<WorkflowRun> {
	await requireStatus(db, id, ['running']);
	await db.update(workflowRuns).set({ status: 'staged' }).where(eq(workflowRuns.id, id));
	const updated = await getWorkflowRun(db, id);
	if (!updated) throw new Error(`workflow_run "${id}" vanished after stage`);
	return updated;
}

export async function completeWorkflowRun(
	db: Database,
	id: string
): Promise<WorkflowRun> {
	await requireStatus(db, id, ['running', 'staged']);
	const completedAt = new Date().toISOString();
	await db
		.update(workflowRuns)
		.set({ status: 'completed', completedAt })
		.where(eq(workflowRuns.id, id));
	const updated = await getWorkflowRun(db, id);
	if (!updated) throw new Error(`workflow_run "${id}" vanished after complete`);
	return updated;
}

export async function failWorkflowRun(
	db: Database,
	id: string,
	error: string
): Promise<WorkflowRun> {
	await requireStatus(db, id, ['running', 'staged']);
	const completedAt = new Date().toISOString();
	await db
		.update(workflowRuns)
		.set({ status: 'failed', error, completedAt })
		.where(eq(workflowRuns.id, id));
	const updated = await getWorkflowRun(db, id);
	if (!updated) throw new Error(`workflow_run "${id}" vanished after fail`);
	return updated;
}
