import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
	ListToolsRequestSchema,
	CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { openMcpClient, type ConnectedMcpClient } from './client';

// In-process echo server — covers the MCP protocol surface without spawning a subprocess.
function makeEchoServer() {
	const server = new Server(
		{ name: 'echo', version: '0.0.1' },
		{ capabilities: { tools: {} } }
	);
	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: [
			{
				name: 'echo',
				description: 'echoes input',
				inputSchema: {
					type: 'object',
					properties: { text: { type: 'string' } }
				}
			}
		]
	}));
	server.setRequestHandler(CallToolRequestSchema, async (req) => {
		if (req.params.name !== 'echo') {
			throw new Error(`unknown tool: ${req.params.name}`);
		}
		const args = (req.params.arguments ?? {}) as Record<string, unknown>;
		return {
			content: [{ type: 'text', text: String(args.text ?? '') }]
		};
	});
	return server;
}

describe('MCP client (in-memory)', () => {
	let client: ConnectedMcpClient;

	beforeEach(async () => {
		const server = makeEchoServer();
		const [clientT, serverT] = InMemoryTransport.createLinkedPair();
		await server.connect(serverT);
		client = await openMcpClient({ transport: clientT, name: 'test-client' });
	});

	afterEach(async () => {
		await client.close();
	});

	it('lists tools', async () => {
		const names = await client.listToolNames();
		expect(names).toContain('echo');
	});

	it('calls a tool and returns its text result', async () => {
		const result = await client.callTool('echo', { text: 'hello' });
		expect(result).toBe('hello');
	});

	it('surfaces errors for unknown tools', async () => {
		await expect(client.callTool('nonexistent', {})).rejects.toThrow();
	});
});
