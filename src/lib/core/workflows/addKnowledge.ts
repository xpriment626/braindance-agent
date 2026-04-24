import type { Database } from '../db/connection';
import type { LLMProvider } from '../agents/llm';
import type { Channel } from '../channels/types';
import type { TopicContext, CorpusSource, AuditOutput, AuditSignal } from '../agents/types';
import { getTopic } from '../knowledge/topics';
import { listSourcesByTopic } from '../knowledge/sources';
import { runDiscover } from '../agents/discover';
import { runAudit } from '../agents/audit';
import {
	createDiscoveryReport,
	type DiscoveredSourceProposal
} from '../knowledge/discovery-reports';
import { createSignal } from '../knowledge/signals';
import {
	createWorkflowRun,
	stageWorkflowRun,
	failWorkflowRun
} from './runs';
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
	if (!topic) throw new Error(`topic "${topicId}" not found`);

	const topicContext: TopicContext = toTopicContext(topic);
	const corpusSources = await loadCorpus(db, topicId);

	const run = await createWorkflowRun(db, {
		type: 'add_knowledge',
		topicId,
		config: options.config
	});

	try {
		const discoverOutput = await runDiscover(
			options.llm,
			options.channels,
			{
				topic: topicContext,
				existingCorpus: corpusSources,
				channelConfig: resolveChannelConfigFromWorkflow(options.channels, options.config)
			}
		);

		const auditOutput = await runAudit(options.llm, {
			topic: topicContext,
			corpus: corpusSources
		});

		const newSources: DiscoveredSourceProposal[] = discoverOutput.discoveredSources.map(
			(s) => ({
				url: s.url,
				title: s.title,
				content: s.content,
				relevanceRationale: s.relevanceRationale,
				confidence: s.confidence,
				threadAssociations: s.threadAssociations,
				scope: s.scope,
				channel: s.channel
			})
		);

		const report = await createDiscoveryReport(db, {
			topicId,
			workflowRunId: run.id,
			summary: buildCombinedSummary(discoverOutput.searchSummary, auditOutput.summary),
			newSources,
			auditFindings: auditOutput as unknown as Record<string, unknown>
		});

		await persistAuditSignals(db, topicId, auditOutput);
		await stageWorkflowRun(db, run.id);

		return { workflowRunId: run.id, discoveryReportId: report.id };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await failWorkflowRun(db, run.id, message);
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

async function persistAuditSignals(
	db: Database,
	topicId: string,
	audit: AuditOutput
): Promise<void> {
	for (const flag of audit.freshnessFlags) {
		await createAuditSignal(db, topicId, flag);
	}
	for (const flag of audit.contradictions) {
		await createAuditSignal(db, topicId, flag);
	}
	for (const gap of audit.gapAnalysis) {
		if (gap.coverage === 'strong') continue; // strong coverage isn't actionable
		await createSignal(db, {
			topicId,
			targetType: 'thread',
			targetId: topicId,
			signalType: 'gap',
			reason: gap.notes,
			raisedBy: 'audit',
			metadata: { thread: gap.thread, coverage: gap.coverage }
		});
	}
	for (const consolidation of audit.consolidationSuggestions) {
		const [canonical, ...superseded] = consolidation.sourceIds;
		if (!canonical) continue;
		await createSignal(db, {
			topicId,
			targetType: 'source',
			targetId: canonical,
			signalType: 'consolidation',
			reason: consolidation.reason,
			raisedBy: 'audit',
			metadata: { canonicalId: canonical, supersededIds: superseded }
		});
	}
}

async function createAuditSignal(
	db: Database,
	topicId: string,
	flag: AuditSignal
): Promise<void> {
	await createSignal(db, {
		topicId,
		targetType: 'source',
		targetId: flag.targetId,
		signalType: flag.signalType,
		reason: flag.reason,
		raisedBy: 'audit'
	});
}
