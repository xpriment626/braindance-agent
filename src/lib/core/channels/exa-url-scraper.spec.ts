import { describe, it, expect } from 'vitest';
import { createExaUrlScraper } from './exa-url-scraper';
import { ChannelUnavailableError } from './types';
import type { ConnectedMcpClient } from '../mcp/client';

function mockMcp(response: unknown): ConnectedMcpClient {
	return {
		async listToolNames() {
			return ['contents'];
		},
		async callTool() {
			return JSON.stringify(response);
		},
		async close() {}
	};
}

describe('ExaUrlScraper', () => {
	it('maps Exa contents response into UrlScraper shape', async () => {
		const mcp = mockMcp({
			results: [
				{
					url: 'https://example.com/post',
					title: 'A Post',
					text: 'The full body of the article',
					summary: 'Short summary',
					publishedDate: '2026-03-01'
				}
			]
		});
		const scraper = createExaUrlScraper(mcp);
		const out = await scraper.scrape('https://example.com/post');

		expect(out.title).toBe('A Post');
		expect(out.content).toBe('The full body of the article');
		expect(out.metadata?.summary).toBe('Short summary');
		expect(out.metadata?.publishedDate).toBe('2026-03-01');
	});

	it('omits missing metadata fields rather than including empty strings', async () => {
		const mcp = mockMcp({
			results: [{ url: 'https://x.com/y', title: 'Y', text: 'content' }]
		});
		const scraper = createExaUrlScraper(mcp);
		const out = await scraper.scrape('https://x.com/y');

		expect(out.content).toBe('content');
		expect(out.metadata).toBeUndefined();
	});

	it('throws ChannelUnavailableError when MCP returns no results', async () => {
		const mcp = mockMcp({ results: [] });
		const scraper = createExaUrlScraper(mcp);
		await expect(scraper.scrape('https://example.com/x')).rejects.toThrow(
			ChannelUnavailableError
		);
	});

	it('throws ChannelUnavailableError when MCP returns non-JSON', async () => {
		const mcp: ConnectedMcpClient = {
			async listToolNames() {
				return ['contents'];
			},
			async callTool() {
				return 'not-json';
			},
			async close() {}
		};
		const scraper = createExaUrlScraper(mcp);
		await expect(scraper.scrape('https://example.com/x')).rejects.toThrow(
			ChannelUnavailableError
		);
	});
});
