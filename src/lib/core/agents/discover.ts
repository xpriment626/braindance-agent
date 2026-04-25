import type { LLMProvider, ChatMessage, ToolDef, ToolCall } from './llm';
import type { DiscoverInput, DiscoverOutput, DiscoveredSource } from './types';
import type { Channel, SearchResult, ExtractedContent } from '../channels/types';

export interface RunDiscoverOptions {
	model?: string;
	maxIterations?: number;
}

const DEFAULT_MODEL = 'moonshotai/kimi-k2.6';
const DEFAULT_MAX_ITERATIONS = 20;
// Minimum distinct search queries the agent must issue before reporting
// empty findings. Defends against models (e.g. Kimi K2.6 in early smoke
// runs) that decide reporting an empty array is a valid first move.
const MIN_SEARCHES_BEFORE_EMPTY_REPORT = 2;

interface ExtractionCacheEntry {
	content: ExtractedContent;
	channel: string;
}

// ─── Tool schemas ─────────────────────────────────────────

function buildTools(channels: Channel[]): ToolDef[] {
	const tools: ToolDef[] = [];
	for (const channel of channels) {
		tools.push({
			name: `search_${channel.name}`,
			description: `Search the ${channel.name} channel for sources matching a query. Returns URLs, titles, and snippets.`,
			inputSchema: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'The search query.' }
				},
				required: ['query']
			}
		});
		tools.push({
			name: `extract_${channel.name}`,
			description: `Fetch full content for a URL from the ${channel.name} channel. Call this after search before reporting a source as a finding.`,
			inputSchema: {
				type: 'object',
				properties: {
					url: { type: 'string', description: 'The URL to extract.' }
				},
				required: ['url']
			}
		});
		if (channel.findSimilar) {
			tools.push({
				name: `find_similar_${channel.name}`,
				description: `Find sources similar to a given URL via the ${channel.name} channel.`,
				inputSchema: {
					type: 'object',
					properties: {
						url: {
							type: 'string',
							description: 'The URL to find similar sources for.'
						}
					},
					required: ['url']
				}
			});
		}
	}

	tools.push({
		name: 'report_findings',
		description:
			'Submit the final list of discovered sources and terminate. Call this exactly once when done discovering. Each source must have been extracted first via extract_<channel>.',
		inputSchema: {
			type: 'object',
			properties: {
				discoveredSources: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							url: { type: 'string' },
							title: { type: 'string' },
							relevanceRationale: { type: 'string' },
							confidence: { type: 'number', minimum: 0, maximum: 1 },
							threadAssociations: { type: 'array', items: { type: 'string' } },
							scope: { type: 'string', enum: ['on_thread', 'adjacent'] }
						},
						required: [
							'url',
							'title',
							'relevanceRationale',
							'confidence',
							'threadAssociations',
							'scope'
						]
					}
				},
				searchSummary: { type: 'string' }
			},
			required: ['discoveredSources', 'searchSummary']
		}
	});

	return tools;
}

// ─── Prompt ───────────────────────────────────────────────

const DISCOVER_SYSTEM_PROMPT = `You are a research discovery agent. You search for sources that extend a knowledge base on a given topic.

Your tools let you search channels, extract content, and find similar pages. Work iteratively:
1. Issue searches tuned to the topic's narrative threads. Try at least two distinct queries before drawing any conclusion about coverage.
2. For promising results, extract their full content.
3. Optionally use find_similar on high-value results to expand coverage.
4. When you have enough, call report_findings exactly once with the sources worth keeping.

Effort floor: do not report empty findings without first issuing at least two distinct search queries. If your first search returns nothing relevant, broaden the query, try a different angle, or search a different narrative thread before deciding the topic has no on-thread sources. Reporting an empty array is a last resort, not a default.

Be selective. Only include sources with confidence >= 0.5. Classify each as "on_thread" (directly about a defined narrative thread) or "adjacent" (interesting lead beyond defined threads).

Every reported source must have been extracted first — do not report URLs you have not extracted.`;

function buildInitialPrompt(input: DiscoverInput): string {
	const existingUrls = input.existingCorpus
		.map((s) => s.originalUrl)
		.filter((u): u is string => typeof u === 'string' && u.length > 0);
	const existingSection =
		existingUrls.length > 0
			? `\nAlready in corpus (do not report these):\n${existingUrls.map((u) => `- ${u}`).join('\n')}\n`
			: '\n';
	return `Topic: ${input.topic.name}
Description: ${input.topic.description ?? 'N/A'}
Research guidance: ${input.topic.guidance ?? 'N/A'}
Narrative threads: ${input.topic.narrativeThreads?.join(', ') ?? 'None defined'}
${existingSection}
Begin discovery. Use the tools to search, extract, and ultimately report findings.`;
}

// ─── Main ─────────────────────────────────────────────────

export async function runDiscover(
	llm: LLMProvider,
	channels: Channel[],
	input: DiscoverInput,
	options: RunDiscoverOptions = {}
): Promise<DiscoverOutput> {
	const model = options.model ?? DEFAULT_MODEL;
	const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

	const enabledChannels = channels.filter((c) => input.channelConfig[c.name]?.enabled);
	const channelByName = new Map(enabledChannels.map((c) => [c.name, c]));
	const tools = buildTools(enabledChannels);

	const existingUrls = new Set(
		input.existingCorpus
			.map((s) => s.originalUrl)
			.filter((u): u is string => typeof u === 'string' && u.length > 0)
	);
	const extractionCache = new Map<string, ExtractionCacheEntry>();
	// Remember the SearchResult for each URL we surface, so extract() sees
	// the title discovered by search rather than a url-as-title placeholder.
	const searchResultsByUrl = new Map<string, SearchResult>();

	const messages: ChatMessage[] = [
		{ role: 'user', content: buildInitialPrompt(input) }
	];

	const distinctSearchQueries = new Set<string>();

	for (let iteration = 0; iteration < maxIterations; iteration++) {
		const result = await llm.generate({
			model,
			system: DISCOVER_SYSTEM_PROMPT,
			messages,
			tools
		});

		if (result.toolCalls.length === 0) {
			throw new Error(
				`Discover agent stopped without calling report_findings (iteration ${iteration}, stopReason=${result.stopReason})`
			);
		}

		messages.push({
			role: 'assistant',
			content: result.text,
			toolCalls: result.toolCalls
		});

		for (const call of result.toolCalls) {
			if (call.name === 'report_findings') {
				const reported = Array.isArray(call.input.discoveredSources)
					? call.input.discoveredSources
					: [];
				if (
					reported.length === 0 &&
					distinctSearchQueries.size < MIN_SEARCHES_BEFORE_EMPTY_REPORT
				) {
					messages.push({
						role: 'tool',
						toolCallId: call.id,
						content: JSON.stringify({
							error: `report_findings rejected: only ${distinctSearchQueries.size} distinct search queries issued so far. Issue at least ${MIN_SEARCHES_BEFORE_EMPTY_REPORT} different queries (broaden phrasing, try a different narrative thread) before reporting empty findings.`
						})
					});
					continue;
				}
				return finalize(call, extractionCache);
			}
			const toolOutput = await dispatchChannelTool(
				call,
				channelByName,
				input.channelConfig,
				existingUrls,
				extractionCache,
				searchResultsByUrl
			);
			if (call.name.startsWith('search_')) {
				const query = asString(call.input.query);
				if (query) distinctSearchQueries.add(query.trim().toLowerCase());
			}
			messages.push({
				role: 'tool',
				toolCallId: call.id,
				content: JSON.stringify(toolOutput)
			});
		}
	}

	throw new Error(
		`Discover agent exceeded maxIterations (${maxIterations}) without calling report_findings`
	);
}

// ─── Tool dispatch ────────────────────────────────────────

async function dispatchChannelTool(
	call: ToolCall,
	channelByName: Map<string, Channel>,
	channelConfig: DiscoverInput['channelConfig'],
	existingUrls: Set<string>,
	extractionCache: Map<string, ExtractionCacheEntry>,
	searchResultsByUrl: Map<string, SearchResult>
): Promise<unknown> {
	const parsed = parseToolName(call.name);
	if (!parsed) {
		return { error: `unknown tool: ${call.name}` };
	}
	const channel = channelByName.get(parsed.channelName);
	if (!channel) {
		return { error: `channel "${parsed.channelName}" not enabled` };
	}
	const params = channelConfig[parsed.channelName]?.params;

	try {
		switch (parsed.operation) {
			case 'search': {
				const query = asString(call.input.query);
				if (!query) return { error: 'search requires a "query" string' };
				const results = await channel.search(query, params);
				for (const r of results) searchResultsByUrl.set(r.url, r);
				return { results: dedupeAndTrim(results, existingUrls) };
			}
			case 'extract': {
				const url = asString(call.input.url);
				if (!url) return { error: 'extract requires a "url" string' };
				const priorSearch = searchResultsByUrl.get(url);
				const target: SearchResult = priorSearch ?? { url, title: url };
				const content = await channel.extract(target);
				extractionCache.set(url, { content, channel: channel.name });
				// Return a token-frugal summary; agent can re-request details if needed.
				return {
					url: content.url,
					title: content.title,
					content: content.content,
					highlights: content.highlights,
					summary: content.summary
				};
			}
			case 'find_similar': {
				if (!channel.findSimilar) {
					return { error: `channel "${channel.name}" does not support find_similar` };
				}
				const url = asString(call.input.url);
				if (!url) return { error: 'find_similar requires a "url" string' };
				const results = await channel.findSimilar(url, params);
				return { results: dedupeAndTrim(results, existingUrls) };
			}
		}
	} catch (error) {
		return {
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

function parseToolName(
	name: string
): { operation: 'search' | 'extract' | 'find_similar'; channelName: string } | null {
	if (name.startsWith('search_')) {
		return { operation: 'search', channelName: name.slice('search_'.length) };
	}
	if (name.startsWith('extract_')) {
		return { operation: 'extract', channelName: name.slice('extract_'.length) };
	}
	if (name.startsWith('find_similar_')) {
		return { operation: 'find_similar', channelName: name.slice('find_similar_'.length) };
	}
	return null;
}

function dedupeAndTrim(
	results: SearchResult[],
	existingUrls: Set<string>
): Array<Pick<SearchResult, 'url' | 'title' | 'snippet' | 'score'>> {
	return results
		.filter((r) => !existingUrls.has(r.url))
		.map((r) => ({ url: r.url, title: r.title, snippet: r.snippet, score: r.score }));
}

// ─── Finalization ─────────────────────────────────────────

function finalize(
	call: ToolCall,
	extractionCache: Map<string, ExtractionCacheEntry>
): DiscoverOutput {
	const input = call.input;
	const reported = Array.isArray(input.discoveredSources) ? input.discoveredSources : [];
	const summary = asString(input.searchSummary) ?? '';

	const discoveredSources: DiscoveredSource[] = [];
	for (const item of reported) {
		if (!isRecord(item)) continue;
		const url = asString(item.url);
		if (!url) continue;
		const cached = extractionCache.get(url);
		if (!cached) continue; // drop sources the LLM never actually extracted

		const scope = item.scope === 'adjacent' ? 'adjacent' : 'on_thread';
		discoveredSources.push({
			url,
			title: asString(item.title) ?? cached.content.title,
			content: cached.content.content,
			relevanceRationale: asString(item.relevanceRationale) ?? '',
			confidence: typeof item.confidence === 'number' ? item.confidence : 0,
			threadAssociations: asStringArray(item.threadAssociations),
			scope,
			channel: cached.channel
		});
	}

	return { discoveredSources, searchSummary: summary };
}

// ─── Local helpers ────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
	return typeof v === 'string' ? v : undefined;
}

function asStringArray(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v.filter((x): x is string => typeof x === 'string');
}
