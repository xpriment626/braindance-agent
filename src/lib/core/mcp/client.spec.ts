import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
	ListToolsRequestSchema,
	CallToolRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { openFromConfig, openMcpClient, type ConnectedMcpClient } from './client';

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

describe('openFromConfig (HTTP transport)', () => {
	let httpServer: HttpServer;
	let mcpServer: Server;
	let transport: StreamableHTTPServerTransport;
	let port: number;

	beforeEach(async () => {
		mcpServer = new Server(
			{ name: 'echo-http', version: '0.0.1' },
			{ capabilities: { tools: {} } }
		);
		mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
			tools: [
				{
					name: 'echo',
					description: 'echoes input',
					inputSchema: { type: 'object', properties: { text: { type: 'string' } } }
				}
			]
		}));
		mcpServer.setRequestHandler(CallToolRequestSchema, async (req) => {
			const args = (req.params.arguments ?? {}) as Record<string, unknown>;
			return { content: [{ type: 'text', text: String(args.text ?? '') }] };
		});

		transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
			enableJsonResponse: true
		});
		await mcpServer.connect(transport);

		httpServer = createServer(async (req, res) => {
			if (new URL(req.url ?? '/', 'http://x').pathname !== '/mcp') {
				res.writeHead(404).end('not found');
				return;
			}
			try {
				await transport.handleRequest(req, res);
			} catch (err) {
				if (!res.headersSent) res.writeHead(500).end(String(err));
			}
		});
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
		port = (httpServer.address() as AddressInfo).port;
	});

	afterEach(async () => {
		await new Promise<void>((resolve) => httpServer.close(() => resolve()));
		await mcpServer.close();
	});

	it('connects over HTTP and calls tools', async () => {
		const client = await openFromConfig('echo-http', {
			url: `http://127.0.0.1:${port}/mcp`
		});
		try {
			const names = await client.listToolNames();
			expect(names).toContain('echo');
			const result = await client.callTool('echo', { text: 'over-http' });
			expect(result).toBe('over-http');
		} finally {
			await client.close();
		}
	});
});
