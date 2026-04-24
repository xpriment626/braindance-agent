import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type Database } from '../db/connection';
import { initProjectDb, workflowRuns } from '../db/schema';
import { createTopic } from '../knowledge/topics';
import { createSeed } from '../knowledge/seeds';
import { createSource } from '../knowledge/sources';
import { generateId } from '../db/id';
import { createMockProvider, toolCallResponse, type LLMProvider } from '../agents/llm';
import { auditCorpus } from './auditCorpus';
import { getWorkflowRun } from './runs';
import { listSignalsByTopic } from '../knowledge/signals';

function mockLLMReturningAudit(): LLMProvider {
	return createMockProvider(
		toolCallResponse([
			{
				id: 'c1',
				name: 'submit_audit',
				input: {
					freshnessFlags: [
						{ targetId: 'src-1', signalType: 'stale', reason: 'old' }
					],
					contradictions: [],
					gapAnalysis: [],
					consolidationSuggestions: [],
					summary: 'one stale source'
				}
			}
		])
	);
}

describe('auditCorpus workflow', () => {
	let db: Database;
	let topicId: string;

	beforeEach(async () => {
		db = createDb(':memory:');
		await initProjectDb(db);
		const topic = await createTopic(db, { name: 'T', narrativeThreads: ['x'] });
		topicId = topic.id;
		const seed = await createSeed(db, {
			topicId,
			type: 'freeform',
			origin: 'user',
			inputCount: 1
		});
		await createSource(db, {
			id: generateId(),
			seedId: seed.id,
			topicId,
			title: 'existing',
			type: 'text',
			content: 'body',
			originalFormat: 'text/plain'
		});
	});

	it('runs audit → stage and persists pending signals, returns their ids', async () => {
		const { workflowRunId, signalIds } = await auditCorpus(db, topicId, {
			llm: mockLLMReturningAudit(),
			config: {}
		});

		const run = await getWorkflowRun(db, workflowRunId);
		expect(run?.status).toBe('staged');
		expect(run?.type).toBe('audit_corpus');

		expect(signalIds).toHaveLength(1);
		const signals = await listSignalsByTopic(db, topicId);
		expect(signals).toHaveLength(1);
		expect(signals[0].id).toBe(signalIds[0]);
		expect(signals[0].status).toBe('pending');
	});

	it('fails the workflow when audit throws', async () => {
		const failingLLM: LLMProvider = {
			async generate() {
				throw new Error('audit LLM down');
			}
		};
		await expect(
			auditCorpus(db, topicId, { llm: failingLLM, config: {} })
		).rejects.toThrow(/audit LLM down/);
		const runs = await db.select().from(workflowRuns);
		expect(runs[0].status).toBe('failed');
	});

	it('throws when topic does not exist', async () => {
		await expect(
			auditCorpus(db, 'nope', { llm: mockLLMReturningAudit(), config: {} })
		).rejects.toThrow(/topic/);
	});
});
