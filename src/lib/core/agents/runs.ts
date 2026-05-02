import { eq } from 'drizzle-orm';
import { agentRuns } from '../db/schema';
import { generateId } from '../db/id';
import type { Database } from '../db/connection';
import {
	parseWorkflowRunError,
	serializeWorkflowRunError,
	type WorkflowRunError
} from '../errors/contract';

export type AgentType = 'discover' | 'audit' | 'prune';
export type AgentRunStatus = 'running' | 'completed' | 'failed';

export interface AgentRun {
	id: string;
	agentType: AgentType;
	topicId: string;
	workflowRunId: string | null;
	status: AgentRunStatus;
	config: string | null;
	startedAt: string;
	completedAt: string | null;
	error: WorkflowRunError | null;
}

interface AgentRunRow {
	id: string;
	agentType: AgentType;
	topicId: string;
	workflowRunId: string | null;
	status: AgentRunStatus;
	config: string | null;
	startedAt: string;
	completedAt: string | null;
	error: string | null;
}

function fromRow(row: AgentRunRow): AgentRun {
	return {
		id: row.id,
		agentType: row.agentType,
		topicId: row.topicId,
		workflowRunId: row.workflowRunId,
		status: row.status,
		config: row.config,
		startedAt: row.startedAt,
		completedAt: row.completedAt,
		error: parseWorkflowRunError(row.error)
	};
}

export interface CreateAgentRunInput {
	agentType: AgentType;
	topicId: string;
	workflowRunId?: string;
	config?: Record<string, unknown>;
}

export async function createAgentRun(
	db: Database,
	input: CreateAgentRunInput
): Promise<AgentRun> {
	const row: AgentRunRow = {
		id: generateId(),
		agentType: input.agentType,
		topicId: input.topicId,
		workflowRunId: input.workflowRunId ?? null,
		status: 'running',
		config: input.config ? JSON.stringify(input.config) : null,
		startedAt: new Date().toISOString(),
		completedAt: null,
		error: null
	};
	await db.insert(agentRuns).values(row);
	return fromRow(row);
}

export async function getAgentRun(db: Database, id: string): Promise<AgentRun | null> {
	const results = (await db
		.select()
		.from(agentRuns)
		.where(eq(agentRuns.id, id))) as AgentRunRow[];
	return results[0] ? fromRow(results[0]) : null;
}

export async function completeAgentRun(db: Database, id: string): Promise<void> {
	await db
		.update(agentRuns)
		.set({ status: 'completed', completedAt: new Date().toISOString() })
		.where(eq(agentRuns.id, id));
}

export async function failAgentRun(
	db: Database,
	id: string,
	error: WorkflowRunError
): Promise<void> {
	await db
		.update(agentRuns)
		.set({
			status: 'failed',
			completedAt: new Date().toISOString(),
			error: serializeWorkflowRunError(error)
		})
		.where(eq(agentRuns.id, id));
}

export async function listAgentRunsByTopic(
	db: Database,
	topicId: string
): Promise<AgentRun[]> {
	const rows = (await db
		.select()
		.from(agentRuns)
		.where(eq(agentRuns.topicId, topicId))) as AgentRunRow[];
	return rows.map(fromRow);
}
