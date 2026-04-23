// Channel interface — thin adapter over an MCP server, shaped around the
// two roles discover needs: search (find candidate sources) + extract (fetch
// full content for a result). findSimilar is optional — channels that can
// do similarity expansion (e.g. Exa) implement it; others skip it.

export interface SearchResult {
	url: string;
	title: string;
	snippet?: string;
	score?: number;
	publishedDate?: string;
}

export interface ExtractedContent {
	url: string;
	title: string;
	content: string;
	highlights?: string[];
	summary?: string;
	metadata?: Record<string, unknown>;
}

export interface Channel {
	name: string;
	search(query: string, params?: Record<string, unknown>): Promise<SearchResult[]>;
	findSimilar?(url: string, params?: Record<string, unknown>): Promise<SearchResult[]>;
	extract(result: SearchResult): Promise<ExtractedContent>;
}

export class ChannelUnavailableError extends Error {
	constructor(
		public readonly channel: string,
		public readonly mcpServer: string,
		public readonly reason: string
	) {
		super(`channel "${channel}" unavailable: mcp_server "${mcpServer}" ${reason}`);
	}
}
