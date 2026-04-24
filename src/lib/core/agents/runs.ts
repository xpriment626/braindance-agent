import { eq } from 'drizzle-orm';
import { agentRuns } from '../db/schema';
import { generateId } from '../db/id';
import type { Database } from '../db/connection';

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
	error: string | null;
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
	const record: AgentRun = {
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
	await db.insert(agentRuns).values(record);
	return record;
}

export async function getAgentRun(db: Database, id: string): Promise<AgentRun | null> {
	const results = await db.select().from(agentRuns).where(eq(agentRuns.id, id));
	return (results[0] as AgentRun | undefined) ?? null;
}

export async function completeAgentRun(db: Database, id: string): Promise<void> {
	await db
		.update(agentRuns)
		.set({ status: 'completed', completedAt: new Date().toISOString() })
		.where(eq(agentRuns.id, id));
}

export async function failAgentRun(db: Database, id: string, error: string): Promise<void> {
	await db
		.update(agentRuns)
		.set({ status: 'failed', completedAt: new Date().toISOString(), error })
		.where(eq(agentRuns.id, id));
}

export async function listAgentRunsByTopic(
	db: Database,
	topicId: string
): Promise<AgentRun[]> {
	return db.select().from(agentRuns).where(eq(agentRuns.topicId, topicId)) as Promise<
		AgentRun[]
	>;
}
