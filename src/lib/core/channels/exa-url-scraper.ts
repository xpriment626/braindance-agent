import type { ConnectedMcpClient } from '../mcp/client';
import type { UrlScraper } from '../knowledge/handlers/types';
import { ChannelUnavailableError } from './types';

// Concrete UrlScraper implementation (Phase 2's interface) backed by the
// Exa MCP `contents` tool. Shares its MCP connection with the web channel
// — both talk to the same Exa server.

export function createExaUrlScraper(mcp: ConnectedMcpClient): UrlScraper {
	return {
		async scrape(url: string) {
			const raw = await mcp.callTool('contents', {
				urls: [url],
				highlights: { numSentences: 5 },
				summary: {}
			});

			let payload: unknown;
			try {
				payload = JSON.parse(raw);
			} catch {
				throw new ChannelUnavailableError(
					'exa-url-scraper',
					'exa',
					`returned non-JSON payload: ${raw.slice(0, 100)}`
				);
			}

			const results = extractResults(payload);
			const page = results[0];
			if (!page) {
				throw new ChannelUnavailableError(
					'exa-url-scraper',
					'exa',
					`returned no results for ${url}`
				);
			}

			const metadata = buildMetadata(page);
			return {
				title: asString(page.title),
				content: asString(page.text) ?? '',
				...(metadata && { metadata })
			};
		}
	};
}

function extractResults(payload: unknown): Record<string, unknown>[] {
	if (!isRecord(payload)) return [];
	const results = payload.results;
	if (!Array.isArray(results)) return [];
	return results.filter(isRecord);
}

function buildMetadata(page: Record<string, unknown>): Record<string, string> | undefined {
	const out: Record<string, string> = {};
	const summary = asString(page.summary);
	if (summary) out.summary = summary;
	const publishedDate = asString(page.publishedDate);
	if (publishedDate) out.publishedDate = publishedDate;
	const author = asString(page.author);
	if (author) out.author = author;
	return Object.keys(out).length > 0 ? out : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | undefined {
	return typeof v === 'string' ? v : undefined;
}
