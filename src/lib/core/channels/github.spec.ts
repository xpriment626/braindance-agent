import { describe, it, expect } from 'vitest';
import { createGithubChannel } from './github';
import { ChannelUnavailableError } from './types';
import type { ConnectedMcpClient } from '../mcp/client';

type ToolResponder = (args: Record<string, unknown>) => string;

function mockMcp(responders: Record<string, ToolResponder>): ConnectedMcpClient {
	return {
		async listToolNames() {
			return Object.keys(responders);
		},
		async callTool(name, args) {
			const responder = responders[name];
			if (!responder) throw new Error(`unknown tool: ${name}`);
			return responder(args);
		},
		async close() {}
	};
}

describe('github channel (DeepWiki MCP)', () => {
	it('identifies as the "github" channel', () => {
		const channel = createGithubChannel(mockMcp({}));
		expect(channel.name).toBe('github');
	});

	it('search calls ask_question once per repo and maps answers to SearchResults', async () => {
		const calls: Array<Record<string, unknown>> = [];
		const channel = createGithubChannel(
			mockMcp({
				ask_question: (args) => {
					calls.push(args);
					return `DeepWiki answer about ${String(args.question)} in ${String(args.owner)}/${String(args.repo)}`;
				}
			})
		);
		const results = await channel.search('how are channels wired', {
			repos: ['modelcontextprotocol/sdk', 'exa-labs/exa-mcp-server']
		});
		expect(calls).toHaveLength(2);
		expect(calls[0]).toEqual({
			owner: 'modelcontextprotocol',
			repo: 'sdk',
			question: 'how are channels wired'
		});
		expect(results).toHaveLength(2);
		expect(results[0].url).toBe('modelcontextprotocol/sdk');
		expect(results[0].title).toContain('modelcontextprotocol/sdk');
		expect(results[0].snippet).toContain('DeepWiki answer');
	});

	it('search returns empty array when no repos are configured', async () => {
		const channel = createGithubChannel(mockMcp({}));
		const results = await channel.search('anything');
		expect(results).toEqual([]);
	});

	it('extract with a path reads a specific wiki page', async () => {
		const channel = createGithubChannel(
			mockMcp({
				read_wiki_contents: (args) =>
					`# Page content for ${String(args.owner)}/${String(args.repo)}/${String(args.path)}`
			})
		);
		const content = await channel.extract({
			url: 'modelcontextprotocol/sdk:docs/transports',
			title: 'Transports'
		});
		expect(content.content).toContain('Page content for modelcontextprotocol/sdk/docs/transports');
	});

	it('extract without a path reads structure + all sections', async () => {
		const readCalls: string[] = [];
		const channel = createGithubChannel(
			mockMcp({
				read_wiki_structure: () =>
					JSON.stringify({
						sections: [{ path: 'intro' }, { path: 'architecture' }]
					}),
				read_wiki_contents: (args) => {
					readCalls.push(String(args.path));
					return `content for ${String(args.path)}`;
				}
			})
		);
		const content = await channel.extract({
			url: 'modelcontextprotocol/sdk',
			title: 'SDK wiki'
		});
		expect(readCalls.sort()).toEqual(['architecture', 'intro']);
		expect(content.content).toContain('content for intro');
		expect(content.content).toContain('content for architecture');
	});

	it('throws ChannelUnavailableError when structure JSON is malformed', async () => {
		const channel = createGithubChannel(
			mockMcp({
				read_wiki_structure: () => 'not-json-at-all'
			})
		);
		await expect(
			channel.extract({ url: 'org/repo', title: 'x' })
		).rejects.toThrow(ChannelUnavailableError);
	});
});
