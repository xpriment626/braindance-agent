import type { Database } from '../db/connection';
import type { LLMProvider } from '../agents/llm';
import type { TopicContext } from '../agents/types';
import { getTopic } from '../knowledge/topics';
import { deleteSource } from '../knowledge/sources';
import { getSignal, applySignal, type Signal } from '../knowledge/signals';
import { ValidationError } from '../errors/types';
import {
	runPrune,
	type PruneMutationTools,
	type PruneOutput
} from '../agents/prune';
import {
	createWorkflowRun,
	completeWorkflowRun,
	failWorkflowRun
} from './runs';
import type { WorkflowConfig } from './addKnowledge';
import { normalizeError } from '../errors/normalize';
import {
	createAgentRun,
	completeAgentRun,
	failAgentRun
} from '../agents/runs';

export interface PruneCorpusOptions {
	llm: LLMProvider;
	config: WorkflowConfig;
}

export interface PruneCorpusResult {
	workflowRunId: string;
	log: PruneOutput;
}

export async function pruneCorpus(
	db: Database,
	topicId: string,
	approvedSignalIds: string[],
	options: PruneCorpusOptions
): Promise<PruneCorpusResult> {
	const topic = await getTopic(db, topicId);
	if (!topic) throw new ValidationError('topic-not-found', `topic "${topicId}" not found`);

	const resolvedSignals = await resolveApprovedSignals(db, topicId, approvedSignalIds);

	const run = await createWorkflowRun(db, {
		type: 'prune_corpus',
		topicId,
		config: { ...options.config, approved_signal_ids: approvedSignalIds }
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

		const mutations: PruneMutationTools = {
			async deleteSource(id) {
				await deleteSource(db, id);
			},
			async markConsolidated(_canonicalId, supersededIds) {
				// MVP: consolidation = delete superseded sources; traceability lives in
				// the prune agent's output log (signal metadata carries canonical+superseded).
				for (const id of supersededIds) {
					await deleteSource(db, id);
				}
			}
		};

		const pruneRun = await createAgentRun(db, {
			agentType: 'prune',
			topicId,
			workflowRunId: run.id
		});
		let log;
		try {
			log = await runPrune(options.llm, mutations, {
				topic: topicContext,
				approvedSignals: resolvedSignals
			});
			await completeAgentRun(db, pruneRun.id);
		} catch (e) {
			await failAgentRun(db, pruneRun.id, normalizeError(e, { agent: 'prune' }));
			throw e;
		}

		for (const mutation of log.appliedMutations) {
			await applySignal(db, mutation.signalId);
		}

		await completeWorkflowRun(db, run.id);
		return { workflowRunId: run.id, log };
	} catch (error) {
		await failWorkflowRun(db, run.id, normalizeError(error));
		throw error;
	}
}

async function resolveApprovedSignals(
	db: Database,
	topicId: string,
	signalIds: string[]
): Promise<Signal[]> {
	const resolved: Signal[] = [];
	for (const id of signalIds) {
		const signal = await getSignal(db, id);
		if (!signal) throw new ValidationError('run-state', `signal "${id}" not found`);
		if (signal.topicId !== topicId) {
			throw new ValidationError(
				'signal-ownership',
				`signal "${id}" belongs to topic "${signal.topicId}", expected "${topicId}"`
			);
		}
		if (signal.status !== 'approved') {
			throw new ValidationError(
				'run-state',
				`signal "${id}" is ${signal.status}, expected approved`
			);
		}
		resolved.push(signal);
	}
	return resolved;
}
