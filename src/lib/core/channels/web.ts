import type { Channel, SearchResult, ExtractedContent } from './types';
import { ChannelUnavailableError } from './types';
import type { ConnectedMcpClient } from '../mcp/client';

// ─── Web channel over the Exa MCP server ─────────────────
// Exa tools consumed: `search`, `find_similar`, `contents`.

export function createWebChannel(mcp: ConnectedMcpClient): Channel {
	return {
		name: 'web',

		async search(query, params) {
			const raw = await mcp.callTool('search', { query, ...params });
			const results = extractResultsArray(raw);
			return results.map(toSearchResult);
		},

		async findSimilar(url, params) {
			const raw = await mcp.callTool('find_similar', { url, ...params });
			const results = extractResultsArray(raw);
			return results.map(toSearchResult);
		},

		async extract(result) {
			const raw = await mcp.callTool('contents', {
				urls: [result.url],
				highlights: { numSentences: 5 },
				summary: {}
			});
			const results = extractResultsArray(raw);
			const page = results[0];
			if (!page) {
				throw new ChannelUnavailableError('web', 'exa', 'returned no results for extraction');
			}
			return toExtractedContent(page, result);
		}
	};
}

// ─── Parsing helpers (defensive, no `any` casts) ─────────

function parseJsonPayload(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		throw new ChannelUnavailableError(
			'web',
			'exa',
			`returned non-JSON payload: ${raw.slice(0, 100)}`
		);
	}
}

function extractResultsArray(raw: string): Record<string, unknown>[] {
	const payload = parseJsonPayload(raw);
	if (!isRecord(payload)) return [];
	const results = payload.results;
	if (!Array.isArray(results)) return [];
	return results.filter(isRecord);
}

function toSearchResult(r: Record<string, unknown>): SearchResult {
	return {
		url: asString(r.url) ?? '',
		title: asString(r.title) ?? '',
		snippet: asString(r.text)?.slice(0, 200),
		score: typeof r.score === 'number' ? r.score : undefined,
		publishedDate: asString(r.publishedDate)
	};
}

function toExtractedContent(
	page: Record<string, unknown>,
	queried: SearchResult
): ExtractedContent {
	return {
		url: asString(page.url) ?? queried.url,
		title: asString(page.title) ?? queried.title,
		content: asString(page.text) ?? '',
		highlights: asStringArray(page.highlights),
		summary: asString(page.summary)
	};
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
	return typeof v === 'string' ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const strings = v.filter((x): x is string => typeof x === 'string');
	return strings.length > 0 ? strings : undefined;
}
