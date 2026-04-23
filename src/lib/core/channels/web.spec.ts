import { describe, it, expect } from 'vitest';
import { createWebChannel } from './web';
import { ChannelUnavailableError } from './types';
import type { ConnectedMcpClient } from '../mcp/client';

function mockMcp(responses: Record<string, unknown>): ConnectedMcpClient {
	return {
		async listToolNames() {
			return Object.keys(responses);
		},
		async callTool(name) {
			return JSON.stringify(responses[name] ?? {});
		},
		async close() {
			// no-op
		}
	};
}

describe('web channel (Exa MCP)', () => {
	it('identifies as the "web" channel', () => {
		const channel = createWebChannel(mockMcp({}));
		expect(channel.name).toBe('web');
	});

	it('maps search → Exa MCP search tool', async () => {
		const mcp = mockMcp({
			search: {
				results: [
					{
						url: 'https://example.com/a',
						title: 'Article A',
						text: 'body text',
						score: 0.9
					}
				]
			}
		});
		const channel = createWebChannel(mcp);
		const results = await channel.search('agents');
		expect(results).toHaveLength(1);
		expect(results[0].url).toBe('https://example.com/a');
		expect(results[0].title).toBe('Article A');
		expect(results[0].score).toBe(0.9);
	});

	it('maps findSimilar → Exa MCP find_similar tool', async () => {
		const mcp = mockMcp({
			find_similar: {
				results: [{ url: 'https://similar.com', title: 'Similar', score: 0.8 }]
			}
		});
		const channel = createWebChannel(mcp);
		const results = await channel.findSimilar!('https://seed.com');
		expect(results[0].url).toBe('https://similar.com');
	});

	it('maps extract → Exa MCP contents tool with highlights + summary', async () => {
		const mcp = mockMcp({
			contents: {
				results: [
					{
						url: 'https://example.com/a',
						title: 'Article A',
						text: 'full content',
						highlights: ['relevant passage'],
						summary: 'short summary'
					}
				]
			}
		});
		const channel = createWebChannel(mcp);
		const content = await channel.extract({
			url: 'https://example.com/a',
			title: 'Article A'
		});
		expect(content.content).toBe('full content');
		expect(content.highlights).toEqual(['relevant passage']);
		expect(content.summary).toBe('short summary');
	});

	it('throws ChannelUnavailableError when MCP returns non-JSON', async () => {
		const client: ConnectedMcpClient = {
			async listToolNames() {
				return ['search'];
			},
			async callTool() {
				return 'not-json-at-all';
			},
			async close() {}
		};
		const channel = createWebChannel(client);
		await expect(channel.search('anything')).rejects.toThrow(ChannelUnavailableError);
	});

	it('throws ChannelUnavailableError when extract finds no results', async () => {
		const mcp = mockMcp({ contents: { results: [] } });
		const channel = createWebChannel(mcp);
		await expect(
			channel.extract({ url: 'https://example.com/x', title: 'X' })
		).rejects.toThrow(ChannelUnavailableError);
	});
});
