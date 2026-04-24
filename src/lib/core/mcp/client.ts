import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { McpServerConfig } from '../config/types';

export interface ConnectedMcpClient {
	listToolNames(): Promise<string[]>;
	callTool(name: string, args: Record<string, unknown>): Promise<string>;
	close(): Promise<void>;
}

export interface OpenOptions {
	transport: Transport;
	name: string;
}

export async function openMcpClient(opts: OpenOptions): Promise<ConnectedMcpClient> {
	const client = new Client({ name: opts.name, version: '0.0.1' });
	await client.connect(opts.transport);

	return {
		async listToolNames() {
			const { tools } = await client.listTools();
			return tools.map((t) => t.name);
		},

		async callTool(name, args) {
			const res = await client.callTool({ name, arguments: args });
			const content = Array.isArray(res.content) ? res.content : [];
			const first = content[0];
			if (!first || typeof first !== 'object') return '';
			// Text content → return the text; anything else → stringify the payload.
			if ('type' in first && first.type === 'text' && 'text' in first) {
				return String(first.text);
			}
			return JSON.stringify(first);
		},

		async close() {
			await client.close();
		}
	};
}

// Factory: open an MCP client from a config entry (stdio-spawned or HTTP-backed).
export async function openFromConfig(
	name: string,
	config: McpServerConfig
): Promise<ConnectedMcpClient> {
	if (config.command) {
		const transport = new StdioClientTransport({
			command: config.command,
			args: config.args ?? [],
			env: config.env
		});
		return openMcpClient({ transport, name });
	}
	if (config.url) {
		const transport = new StreamableHTTPClientTransport(new URL(config.url));
		return openMcpClient({ transport, name });
	}
	throw new Error(`MCP server "${name}" has neither command nor url`);
}
