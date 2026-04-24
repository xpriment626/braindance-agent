import type { Channel, SearchResult, ExtractedContent } from './types';
import { ChannelUnavailableError } from './types';
import type { ConnectedMcpClient } from '../mcp/client';

// ─── GitHub channel over the DeepWiki MCP server ─────────
// DeepWiki tools consumed: `ask_question`, `read_wiki_structure`, `read_wiki_contents`.
// URL encoding for results: `owner/repo` for whole-wiki, `owner/repo:path` for specific page.

export function createGithubChannel(mcp: ConnectedMcpClient): Channel {
	return {
		name: 'github',

		async search(query, params) {
			const repos = asStringArray(params?.repos) ?? [];
			const results: SearchResult[] = [];
			for (const repoFullName of repos) {
				const [owner, repo] = repoFullName.split('/');
				if (!owner || !repo) continue;
				const raw = await mcp.callTool('ask_question', { owner, repo, question: query });
				results.push({
					url: `${owner}/${repo}`,
					title: `${repoFullName}: ${query}`,
					snippet: raw.slice(0, 200)
				});
			}
			return results;
		},

		async extract(result): Promise<ExtractedContent> {
			const [repoFullName, wikiPath] = result.url.split(':');
			const [owner, repo] = repoFullName.split('/');
			if (!owner || !repo) {
				throw new ChannelUnavailableError(
					'github',
					'deepwiki',
					`invalid repo url "${result.url}" (expected "owner/repo[:path]")`
				);
			}

			if (wikiPath) {
				const content = await mcp.callTool('read_wiki_contents', { owner, repo, path: wikiPath });
				return { url: result.url, title: result.title, content };
			}

			const structureRaw = await mcp.callTool('read_wiki_structure', { owner, repo });
			const structure = parseJsonPayload(structureRaw);
			const sectionPaths = extractSectionPaths(structure);
			const sections = await Promise.all(
				sectionPaths.map((path) => mcp.callTool('read_wiki_contents', { owner, repo, path }))
			);
			return {
				url: result.url,
				title: result.title,
				content: sections.join('\n\n---\n\n')
			};
		}
	};
}

function parseJsonPayload(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		throw new ChannelUnavailableError(
			'github',
			'deepwiki',
			`returned non-JSON structure: ${raw.slice(0, 100)}`
		);
	}
}

function extractSectionPaths(structure: unknown): string[] {
	if (!isRecord(structure)) return [];
	const sections = structure.sections;
	if (!Array.isArray(sections)) return [];
	return sections
		.filter(isRecord)
		.map((s) => (typeof s.path === 'string' ? s.path : null))
		.filter((p): p is string => p !== null);
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] | undefined {
	if (!Array.isArray(v)) return undefined;
	const strings = v.filter((x): x is string => typeof x === 'string');
	return strings.length > 0 ? strings : undefined;
}
