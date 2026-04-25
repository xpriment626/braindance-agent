import { describe, it, expect, beforeEach } from 'vitest';
import { createDb, type Database } from '../db/connection';
import { initProjectDb } from '../db/schema';
import { createTopic } from '../knowledge/topics';
import { createSeed } from '../knowledge/seeds';
import { createSource } from '../knowledge/sources';
import { generateId } from '../db/id';
import { createMockProvider, toolCallResponse, type LLMProvider } from '../agents/llm';
import type { Channel } from '../channels/types';
import { addKnowledge } from './addKnowledge';
import { getDiscoveryReport } from '../knowledge/discovery-reports';
import { getWorkflowRun } from './runs';
import { listSignalsByTopic } from '../knowledge/signals';

function mockWebChannel(): Channel {
	return {
		name: 'web',
		async search() {
			return [{ url: 'https://example.com/a', title: 'A', snippet: 's' }];
		},
		async extract(result) {
			return { url: result.url, title: result.title, content: 'full content of A' };
		}
	};
}

function mockLLM(): LLMProvider {
	return createMockProvider(
		// Discover: search then extract then report.
		toolCallResponse([
			{ id: 'c1', name: 'search_web', input: { query: 'agents' } }
		]),
		toolCallResponse([
			{ id: 'c2', name: 'extract_web', input: { url: 'https://example.com/a' } }
		]),
		toolCallResponse([
			{
				id: 'c3',
				name: 'report_findings',
				input: {
					discoveredSources: [
						{
							url: 'https://example.com/a',
							title: 'A',
							relevanceRationale: 'directly about agents',
							confidence: 0.9,
							threadAssociations: ['agents'],
							scope: 'on_thread'
						}
					],
					searchSummary: 'found one source'
				}
			}
		]),
		// Audit: submit_audit directly.
		toolCallResponse([
			{
				id: 'c4',
				name: 'submit_audit',
				input: {
					freshnessFlags: [
						{ targetId: 'src-existing', signalType: 'stale', reason: '10 months old' }
					],
					contradictions: [],
					gapAnalysis: [{ thread: 'mcp', coverage: 'thin', notes: 'only one source' }],
					consolidationSuggestions: [],
					summary: 'one stale source, mcp thread is thin'
				}
			}
		])
	);
}

async function seedExistingSource(db: Database, topicId: string): Promise<string> {
	const seed = await createSeed(db, {
		topicId,
		type: 'freeform',
		origin: 'user',
		inputCount: 1,
		topicSnapshot: {}
	});
	const sourceId = generateId();
	await createSource(db, {
		id: sourceId,
		seedId: seed.id,
		topicId,
		title: 'existing source',
		type: 'text',
		content: 'body',
		originalFormat: 'text/plain'
	});
	return sourceId;
}

describe('addKnowledge workflow', () => {
	let db: Database;
	let topicId: string;

	beforeEach(async () => {
		db = createDb(':memory:');
		await initProjectDb(db);
		const topic = await createTopic(db, {
			name: 'Agent Protocols',
			description: 'agent coordination',
			narrativeThreads: ['mcp', 'a2a']
		});
		topicId = topic.id;
	});

	it('runs discover → audit → stage, producing a discovery_report and pending signals', async () => {
		await seedExistingSource(db, topicId);
		const { workflowRunId, discoveryReportId } = await addKnowledge(db, topicId, {
			llm: mockLLM(),
			channels: [mockWebChannel()],
			config: { channels: { web: { enabled: true } } }
		});

		const run = await getWorkflowRun(db, workflowRunId);
		expect(run?.status).toBe('staged');
		expect(run?.type).toBe('add_knowledge');

		const report = await getDiscoveryReport(db, discoveryReportId);
		expect(report?.status).toBe('pending');
		expect(report?.newSources).toHaveLength(1);
		expect(report?.newSources[0].url).toBe('https://example.com/a');
		expect(report?.newSources[0].status).toBe('pending');
		expect(report?.summary).toContain('stale');

		const signals = await listSignalsByTopic(db, topicId);
		expect(signals).toHaveLength(2);
		const stale = signals.find((s) => s.signalType === 'stale');
		const gap = signals.find((s) => s.signalType === 'gap');
		expect(stale?.status).toBe('pending');
		expect(gap?.status).toBe('pending');
		expect(gap?.targetType).toBe('thread');
	});

	it('fails the workflow when discover throws', async () => {
		const failingLLM: LLMProvider = {
			async generate() {
				throw new Error('LLM down');
			}
		};
		await expect(
			addKnowledge(db, topicId, {
				llm: failingLLM,
				channels: [mockWebChannel()],
				config: {}
			})
		).rejects.toThrow(/LLM down/);
		// The workflow run should be marked failed, not left running.
		const runs = await db
			.select()
			.from((await import('../db/schema')).workflowRuns)
			.execute();
		expect(runs).toHaveLength(1);
		expect(runs[0].status).toBe('failed');
		expect(runs[0].error).toContain('LLM down');
	});

	it('throws when the topic does not exist', async () => {
		await expect(
			addKnowledge(db, 'does-not-exist', {
				llm: mockLLM(),
				channels: [mockWebChannel()],
				config: {}
			})
		).rejects.toThrow(/topic/);
	});
});
