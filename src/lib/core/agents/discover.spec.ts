import { describe, it, expect } from 'vitest';
import {
	createMockProvider,
	textResponse,
	toolCallResponse,
	type ToolCall
} from './llm';
import { runDiscover } from './discover';
import type { DiscoverInput } from './types';
import type { Channel, SearchResult } from '../channels/types';

// ─── Helpers ──────────────────────────────────────────────

function mockChannel(overrides: Partial<Channel> = {}): Channel {
	const defaults: Channel = {
		name: 'web',
		search: async () => [],
		findSimilar: async () => [],
		extract: async (r: SearchResult) => ({
			url: r.url,
			title: r.title,
			content: `Content for ${r.title}`
		})
	};
	return { ...defaults, ...overrides };
}

const BASE_INPUT: DiscoverInput = {
	topic: {
		id: 'topic-1',
		name: 'Agent Protocols',
		description: 'Research on agent coordination',
		guidance: 'Focus on open-source implementations',
		narrativeThreads: ['MCP', 'A2A']
	},
	existingCorpus: [],
	channelConfig: { web: { enabled: true } }
};

function searchCall(query: string, id = 'c1'): ToolCall {
	return { id, name: 'search_web', input: { query } };
}
function extractCall(url: string, id = 'c2'): ToolCall {
	return { id, name: 'extract_web', input: { url } };
}
function reportCall(sources: unknown[], summary: string, id = 'c9'): ToolCall {
	return {
		id,
		name: 'report_findings',
		input: { discoveredSources: sources, searchSummary: summary }
	};
}

// ─── Tests ────────────────────────────────────────────────

describe('runDiscover', () => {
	it('drives the tool-use loop and returns findings', async () => {
		const channel = mockChannel({
			search: async () => [
				{ url: 'https://example.com/mcp', title: 'MCP Article', snippet: 'About MCP' }
			]
		});

		const provider = createMockProvider(
			// 1st turn: model searches
			toolCallResponse([searchCall('MCP protocol')]),
			// 2nd turn: model extracts a result from the search
			toolCallResponse([extractCall('https://example.com/mcp')]),
			// 3rd turn: model reports findings
			toolCallResponse([
				reportCall(
					[
						{
							url: 'https://example.com/mcp',
							title: 'MCP Article',
							relevanceRationale: 'Directly discusses MCP protocol',
							confidence: 0.9,
							threadAssociations: ['MCP'],
							scope: 'on_thread'
						}
					],
					'Found 1 MCP article'
				)
			])
		);

		const output = await runDiscover(provider, [channel], BASE_INPUT);

		expect(output.discoveredSources).toHaveLength(1);
		const src = output.discoveredSources[0];
		expect(src.url).toBe('https://example.com/mcp');
		expect(src.title).toBe('MCP Article');
		expect(src.confidence).toBe(0.9);
		// Content is filled from the extraction cache, not from the LLM output.
		expect(src.content).toBe('Content for MCP Article');
		expect(src.channel).toBe('web');
		expect(output.searchSummary).toBe('Found 1 MCP article');
	});

	it('filters search results against the existing corpus before the LLM sees them', async () => {
		let searchResultsReturned: SearchResult[] = [];
		const channel = mockChannel({
			search: async () => {
				searchResultsReturned = [
					{ url: 'https://known.example.com', title: 'Known' },
					{ url: 'https://new.example.com', title: 'New' }
				];
				return searchResultsReturned;
			}
		});

		const input: DiscoverInput = {
			...BASE_INPUT,
			existingCorpus: [
				{
					id: 'src-1',
					title: 'Known',
					type: 'url',
					content: null,
					originalUrl: 'https://known.example.com',
					metadata: null,
					createdAt: '2026-01-01'
				}
			]
		};

		const provider = createMockProvider(
			toolCallResponse([searchCall('anything', 'sa')]),
			// Issue a second distinct search so the empty report below is allowed.
			toolCallResponse([searchCall('alternate angle', 'sb')]),
			toolCallResponse([reportCall([], 'no new findings')])
		);

		await runDiscover(provider, [channel], input);

		// Second LLM call: the assistant saw the search tool result.
		// Find the tool message in the provider's recorded messages.
		const toolMessage = provider.calls[1].messages.find((m) => m.role === 'tool');
		expect(toolMessage).toBeDefined();
		expect(toolMessage!.content).toContain('new.example.com');
		expect(toolMessage!.content).not.toContain('known.example.com');
	});

	it('exposes channel tools as search_<name>, extract_<name>, find_similar_<name>', async () => {
		const channel = mockChannel();
		const provider = createMockProvider(
			toolCallResponse([searchCall('q1', 'a')]),
			toolCallResponse([searchCall('q2', 'b')]),
			toolCallResponse([reportCall([], 'empty')])
		);

		await runDiscover(provider, [channel], BASE_INPUT);

		const toolsSeen = provider.calls[0].tools!;
		const names = toolsSeen.map((t) => t.name);
		expect(names).toContain('search_web');
		expect(names).toContain('extract_web');
		expect(names).toContain('find_similar_web');
		expect(names).toContain('report_findings');
	});

	it('omits find_similar_<name> when channel does not implement it', async () => {
		const channel: Channel = {
			name: 'web',
			search: async () => [],
			extract: async (r) => ({ url: r.url, title: r.title, content: '' })
			// no findSimilar
		};
		const provider = createMockProvider(
			toolCallResponse([searchCall('q1', 'a')]),
			toolCallResponse([searchCall('q2', 'b')]),
			toolCallResponse([reportCall([], 'empty')])
		);

		await runDiscover(provider, [channel], BASE_INPUT);

		const names = provider.calls[0].tools!.map((t) => t.name);
		expect(names).not.toContain('find_similar_web');
	});

	it('throws when the LLM stops without calling report_findings', async () => {
		const channel = mockChannel();
		const provider = createMockProvider(textResponse('I give up'));

		await expect(runDiscover(provider, [channel], BASE_INPUT)).rejects.toThrow(
			/report_findings/
		);
	});

	it('throws when the loop exceeds maxIterations without finishing', async () => {
		const channel = mockChannel({
			search: async () => [{ url: 'https://a.com', title: 'A' }]
		});
		// Provider always asks for another search — never reports.
		const provider = createMockProvider(toolCallResponse([searchCall('loop')]));

		await expect(
			runDiscover(provider, [channel], BASE_INPUT, { maxIterations: 3 })
		).rejects.toThrow(/maxIterations/);
	});

	it('drops reported sources whose URL was never extracted', async () => {
		const channel = mockChannel();
		const provider = createMockProvider(
			toolCallResponse([
				reportCall(
					[
						{
							url: 'https://never-extracted.com',
							title: 'Phantom',
							relevanceRationale: 'made up',
							confidence: 0.8,
							threadAssociations: [],
							scope: 'adjacent'
						}
					],
					'phantom report'
				)
			])
		);

		const output = await runDiscover(provider, [channel], BASE_INPUT);
		// No extraction happened → no valid content → source is dropped.
		// (Non-empty report bypasses the search-floor guard.)
		expect(output.discoveredSources).toHaveLength(0);
	});

	it('only enables channels whose channelConfig entry has enabled: true', async () => {
		const enabled = mockChannel({ name: 'web' });
		const disabled = mockChannel({ name: 'github' });

		const input: DiscoverInput = {
			...BASE_INPUT,
			channelConfig: {
				web: { enabled: true },
				github: { enabled: false }
			}
		};

		const provider = createMockProvider(
			toolCallResponse([searchCall('q1', 'a')]),
			toolCallResponse([searchCall('q2', 'b')]),
			toolCallResponse([reportCall([], 'noop')])
		);

		await runDiscover(provider, [enabled, disabled], input);

		const names = provider.calls[0].tools!.map((t) => t.name);
		expect(names).toContain('search_web');
		expect(names).not.toContain('search_github');
	});

	it('rejects empty report_findings issued before MIN_SEARCHES distinct queries', async () => {
		const channel = mockChannel({
			search: async () => [{ url: 'https://eventually.com', title: 'Eventually' }]
		});
		const provider = createMockProvider(
			// Premature empty report — should be pushed back
			toolCallResponse([reportCall([], 'too soon', 'r0')]),
			// Model retries with searches
			toolCallResponse([searchCall('first try', 'sa')]),
			toolCallResponse([searchCall('second try', 'sb')]),
			// Now empty is allowed
			toolCallResponse([reportCall([], 'tried both', 'r1')])
		);

		const output = await runDiscover(provider, [channel], BASE_INPUT);
		expect(output.discoveredSources).toHaveLength(0);

		// The provider was called 4 times (premature report + 2 searches + final report)
		expect(provider.calls.length).toBe(4);
		// And the second call should have seen a tool message rejecting the premature report
		const rejection = provider.calls[1].messages.find(
			(m) => m.role === 'tool' && m.toolCallId === 'r0'
		);
		expect(rejection).toBeDefined();
		expect(rejection!.content).toContain('rejected');
	});

	it('counts repeated identical queries as one distinct search', async () => {
		const channel = mockChannel({ search: async () => [] });
		const provider = createMockProvider(
			toolCallResponse([searchCall('same', 'a')]),
			toolCallResponse([searchCall('same', 'b')]),
			// Still only 1 distinct query — empty report should be rejected
			toolCallResponse([reportCall([], 'too soon', 'r0')]),
			toolCallResponse([searchCall('different', 'c')]),
			toolCallResponse([reportCall([], 'now ok', 'r1')])
		);

		await runDiscover(provider, [channel], BASE_INPUT);
		expect(provider.calls.length).toBe(5);
	});
});
