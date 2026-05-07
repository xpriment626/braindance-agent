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

		// Audit signals from add_knowledge are FK-pinned to their parent
		// discovery_report so Signal Review can scope to the run that produced
		// them (decision 4 in Phase B spec).
		expect(stale?.discoveryReportId).toBe(discoveryReportId);
		expect(gap?.discoveryReportId).toBe(discoveryReportId);
	});

	it('fails the workflow when discover throws and persists structured error', async () => {
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

		// The workflow run should be marked failed with a parseable structured error.
		const { getWorkflowRun, listWorkflowRunsByTopic } = await import('./runs');
		const wfRuns = await listWorkflowRunsByTopic(db, topicId);
		expect(wfRuns).toHaveLength(1);
		const wf = await getWorkflowRun(db, wfRuns[0].id);
		expect(wf!.status).toBe('failed');
		expect(wf!.error).not.toBeNull();
		expect(wf!.error!.message).toContain('LLM down');
		expect(wf!.error!.code).toBe('INTERNAL'); // unrecognized untyped throw

		// The discover agent_run should also be marked failed with agent='discover'.
		const { listAgentRunsByTopic } = await import('../agents/runs');
		const agents = await listAgentRunsByTopic(db, topicId);
		const discoverFailed = agents.find(
			(a) => a.agentType === 'discover' && a.status === 'failed'
		);
		expect(discoverFailed).toBeDefined();
		expect(discoverFailed!.error!.agent).toBe('discover');
		expect(discoverFailed!.error!.message).toContain('LLM down');
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

	describe('empty report auto-dismiss (B.3)', () => {
		// Discover enforces a 2-distinct-search floor before accepting empty
		// report_findings (the K2.6 anti-empty rule). Mocks must issue at least
		// two searches before reporting empty.
		function emptyResultLLM(): LLMProvider {
			return createMockProvider(
				toolCallResponse([
					{ id: 's1', name: 'search_web', input: { query: 'agents alpha' } }
				]),
				toolCallResponse([
					{ id: 's2', name: 'search_web', input: { query: 'agents beta' } }
				]),
				toolCallResponse([
					{
						id: 'r',
						name: 'report_findings',
						input: { discoveredSources: [], searchSummary: 'no relevant results' }
					}
				]),
				// Audit: submit empty across the board.
				toolCallResponse([
					{
						id: 'a',
						name: 'submit_audit',
						input: {
							freshnessFlags: [],
							contradictions: [],
							gapAnalysis: [],
							consolidationSuggestions: [],
							summary: 'corpus is healthy, no findings'
						}
					}
				])
			);
		}

		it('auto-dismisses report when both proposals and signals are empty', async () => {
			const { workflowRunId, discoveryReportId } = await addKnowledge(db, topicId, {
				llm: emptyResultLLM(),
				channels: [mockWebChannel()],
				config: { channels: { web: { enabled: true } } }
			});

			const report = await getDiscoveryReport(db, discoveryReportId);
			expect(report?.status).toBe('dismissed');
			expect(report?.reviewedAt).toBeTruthy();
			expect(report?.newSources).toHaveLength(0);

			// Workflow_run goes directly to completed, skipping the staged-for-review state.
			const run = await getWorkflowRun(db, workflowRunId);
			expect(run?.status).toBe('completed');
			expect(run?.completedAt).toBeTruthy();

			const signals = await listSignalsByTopic(db, topicId);
			expect(signals).toHaveLength(0);
		});

		it('still stages for review when proposals exist but signals are empty', async () => {
			const llm = createMockProvider(
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
									relevanceRationale: 'on topic',
									confidence: 0.8,
									threadAssociations: ['agents'],
									scope: 'on_thread'
								}
							],
							searchSummary: 'one result'
						}
					}
				]),
				toolCallResponse([
					{
						id: 'c4',
						name: 'submit_audit',
						input: {
							freshnessFlags: [],
							contradictions: [],
							gapAnalysis: [],
							consolidationSuggestions: [],
							summary: 'corpus is healthy'
						}
					}
				])
			);
			const { workflowRunId, discoveryReportId } = await addKnowledge(db, topicId, {
				llm,
				channels: [mockWebChannel()],
				config: { channels: { web: { enabled: true } } }
			});
			const report = await getDiscoveryReport(db, discoveryReportId);
			expect(report?.status).toBe('pending');
			const run = await getWorkflowRun(db, workflowRunId);
			expect(run?.status).toBe('staged');
		});

		it('still stages for review when signals exist but proposals are empty', async () => {
			await seedExistingSource(db, topicId);
			// Two searches before empty report_findings, per the discover floor.
			const llm = createMockProvider(
				toolCallResponse([
					{ id: 's1', name: 'search_web', input: { query: 'agents alpha' } }
				]),
				toolCallResponse([
					{ id: 's2', name: 'search_web', input: { query: 'agents beta' } }
				]),
				toolCallResponse([
					{
						id: 'r',
						name: 'report_findings',
						input: { discoveredSources: [], searchSummary: 'nothing new' }
					}
				]),
				toolCallResponse([
					{
						id: 'a',
						name: 'submit_audit',
						input: {
							freshnessFlags: [
								{ targetId: 'src-existing', signalType: 'stale', reason: 'old' }
							],
							contradictions: [],
							gapAnalysis: [],
							consolidationSuggestions: [],
							summary: 'one stale source'
						}
					}
				])
			);
			const { workflowRunId, discoveryReportId } = await addKnowledge(db, topicId, {
				llm,
				channels: [mockWebChannel()],
				config: { channels: { web: { enabled: true } } }
			});
			const report = await getDiscoveryReport(db, discoveryReportId);
			expect(report?.status).toBe('pending');
			const run = await getWorkflowRun(db, workflowRunId);
			expect(run?.status).toBe('staged');
		});
	});
});
