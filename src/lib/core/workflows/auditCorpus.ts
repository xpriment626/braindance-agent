import type { Database } from '../db/connection';
import type { LLMProvider } from '../agents/llm';
import type { TopicContext, CorpusSource } from '../agents/types';
import { getTopic } from '../knowledge/topics';
import { ValidationError } from '../errors/types';
import { listSourcesByTopic } from '../knowledge/sources';
import { runAudit } from '../agents/audit';
import {
	createWorkflowRun,
	stageWorkflowRun,
	failWorkflowRun
} from './runs';
import { persistAuditSignals } from './persistAuditSignals';
import type { WorkflowConfig } from './addKnowledge';
import { normalizeError } from '../errors/normalize';
import {
	createAgentRun,
	completeAgentRun,
	failAgentRun
} from '../agents/runs';

export interface AuditCorpusOptions {
	llm: LLMProvider;
	config: WorkflowConfig;
}

export interface AuditCorpusResult {
	workflowRunId: string;
	signalIds: string[];
}

export async function auditCorpus(
	db: Database,
	topicId: string,
	options: AuditCorpusOptions
): Promise<AuditCorpusResult> {
	const topic = await getTopic(db, topicId);
	if (!topic) throw new ValidationError('topic-not-found', `topic "${topicId}" not found`);

	const run = await createWorkflowRun(db, {
		type: 'audit_corpus',
		topicId,
		config: options.config
	});

	try {
		const topicContext: TopicContext = {
			id: topic.id,
			name: topic.name,
			description: topic.description,
			guidance: topic.guidance,
			narrativeThreads: topic.narrativeThreads
				? (JSON.parse(topic.narrativeThreads) as string[])
				: null
		};
		const corpus: CorpusSource[] = (await listSourcesByTopic(db, topicId)).map((s) => ({
			id: s.id,
			title: s.title,
			type: s.type,
			content: s.content,
			originalUrl: s.originalUrl,
			metadata: s.metadata ? (JSON.parse(s.metadata) as Record<string, unknown>) : null,
			createdAt: s.createdAt
		}));

		const auditRun = await createAgentRun(db, {
			agentType: 'audit',
			topicId,
			workflowRunId: run.id
		});
		let auditOutput;
		try {
			auditOutput = await runAudit(options.llm, { topic: topicContext, corpus });
			await completeAgentRun(db, auditRun.id);
		} catch (e) {
			await failAgentRun(db, auditRun.id, normalizeError(e, { agent: 'audit' }));
			throw e;
		}
		const signalIds = await persistAuditSignals(db, topicId, auditOutput);
		await stageWorkflowRun(db, run.id);

		return { workflowRunId: run.id, signalIds };
	} catch (error) {
		await failWorkflowRun(db, run.id, normalizeError(error));
		throw error;
	}
}
