import type { Database } from '../db/connection';
import type { LLMProvider } from '../agents/llm';
import type { Channel } from '../channels/types';
import type { TopicContext, CorpusSource } from '../agents/types';
import { getTopic } from '../knowledge/topics';
import { listSourcesByTopic } from '../knowledge/sources';
import { runDiscover } from '../agents/discover';
import { runAudit } from '../agents/audit';
import {
	createDiscoveryReport,
	dismissDiscoveryReport,
	type DiscoveredSourceProposal
} from '../knowledge/discovery-reports';
import {
	createWorkflowRun,
	stageWorkflowRun,
	completeWorkflowRun,
	failWorkflowRun
} from './runs';
import { persistAuditSignals } from './persistAuditSignals';
import { ValidationError } from '../errors/types';
import { normalizeError } from '../errors/normalize';
import {
	createAgentRun,
	completeAgentRun,
	failAgentRun
} from '../agents/runs';
import type { RunChannelOverride } from '../channels/resolve';

export interface WorkflowConfig {
	channels?: Record<string, RunChannelOverride>;
	[key: string]: unknown;
}

export interface AddKnowledgeOptions {
	llm: LLMProvider;
	channels: Channel[];
	config: WorkflowConfig;
}

export interface AddKnowledgeResult {
	workflowRunId: string;
	discoveryReportId: string;
}

export async function addKnowledge(
	db: Database,
	topicId: string,
	options: AddKnowledgeOptions
): Promise<AddKnowledgeResult> {
	const topic = await getTopic(db, topicId);
	if (!topic) throw new ValidationError('topic-not-found', `topic "${topicId}" not found`);

	const topicContext: TopicContext = toTopicContext(topic);
	const corpusSources = await loadCorpus(db, topicId);

	const run = await createWorkflowRun(db, {
		type: 'add_knowledge',
		topicId,
		config: options.config
	});

	try {
		// Discover: wrap in agent_runs row so per-agent failures are surfaced
		// for triage even when the outer workflow_run row also captures them.
		const discoverRun = await createAgentRun(db, {
			agentType: 'discover',
			topicId,
			workflowRunId: run.id
		});
		let discoverOutput;
		try {
			discoverOutput = await runDiscover(options.llm, options.channels, {
				topic: topicContext,
				existingCorpus: corpusSources,
				channelConfig: resolveChannelConfigFromWorkflow(options.channels, options.config)
			});
			await completeAgentRun(db, discoverRun.id);
		} catch (e) {
			await failAgentRun(db, discoverRun.id, normalizeError(e, { agent: 'discover' }));
			throw e;
		}

		const auditRun = await createAgentRun(db, {
			agentType: 'audit',
			topicId,
			workflowRunId: run.id
		});
		let auditOutput;
		try {
			auditOutput = await runAudit(options.llm, {
				topic: topicContext,
				corpus: corpusSources
			});
			await completeAgentRun(db, auditRun.id);
		} catch (e) {
			await failAgentRun(db, auditRun.id, normalizeError(e, { agent: 'audit' }));
			throw e;
		}

		const newSources: DiscoveredSourceProposal[] = discoverOutput.discoveredSources.map(
			(s) => ({
				url: s.url,
				title: s.title,
				content: s.content,
				relevanceRationale: s.relevanceRationale,
				confidence: s.confidence,
				threadAssociations: s.threadAssociations,
				scope: s.scope,
				channel: s.channel,
				status: 'pending'
			})
		);

		const report = await createDiscoveryReport(db, {
			topicId,
			workflowRunId: run.id,
			summary: buildCombinedSummary(discoverOutput.searchSummary, auditOutput.summary),
			newSources,
			auditFindings: auditOutput as unknown as Record<string, unknown>
		});

		// Tie audit signals to their parent discovery_report so Signal Review
		// can scope to the run that produced them (decision 4).
		const persistedSignalIds = await persistAuditSignals(
			db,
			topicId,
			auditOutput,
			report.id
		);

		// B.3: auto-dismiss empty reports so the inbox doesn't strand them
		// (and openDiscoveryReportForReview doesn't throw on zero proposals).
		// Workflow_run goes directly running → completed; there's nothing to
		// stage for review. The report carries the "dismissed" outcome.
		if (newSources.length === 0 && persistedSignalIds.length === 0) {
			await dismissDiscoveryReport(db, report.id);
			await completeWorkflowRun(db, run.id);
		} else {
			await stageWorkflowRun(db, run.id);
		}

		return { workflowRunId: run.id, discoveryReportId: report.id };
	} catch (error) {
		await failWorkflowRun(db, run.id, normalizeError(error));
		throw error;
	}
}

// ─── Helpers ──────────────────────────────────────────────

function toTopicContext(row: {
	id: string;
	name: string;
	description: string | null;
	guidance: string | null;
	narrativeThreads: string | null;
}): TopicContext {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		guidance: row.guidance,
		narrativeThreads: row.narrativeThreads
			? (JSON.parse(row.narrativeThreads) as string[])
			: null
	};
}

async function loadCorpus(db: Database, topicId: string): Promise<CorpusSource[]> {
	const sources = await listSourcesByTopic(db, topicId);
	return sources.map((s) => ({
		id: s.id,
		title: s.title,
		type: s.type,
		content: s.content,
		originalUrl: s.originalUrl,
		metadata: s.metadata ? (JSON.parse(s.metadata) as Record<string, unknown>) : null,
		createdAt: s.createdAt
	}));
}

function resolveChannelConfigFromWorkflow(
	channels: Channel[],
	config: WorkflowConfig
): Record<string, { enabled: boolean; params?: Record<string, unknown> }> {
	const out: Record<string, { enabled: boolean; params?: Record<string, unknown> }> = {};
	for (const channel of channels) {
		const override = config.channels?.[channel.name];
		out[channel.name] = {
			enabled: override?.enabled !== false,
			params: override?.params
		};
	}
	return out;
}

function buildCombinedSummary(searchSummary: string, auditSummary: string): string {
	return `Discovery: ${searchSummary}\n\nAudit: ${auditSummary}`;
}

