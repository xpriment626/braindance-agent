import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { openRegistry, createProject } from '../projects/project';
import { createTopic } from '../knowledge/topics';
import { createBraindanceMcpServer } from './server';

function firstTextBlock(content: unknown): string {
	if (!Array.isArray(content)) throw new Error('expected array content');
	const first = content[0];
	if (
		first &&
		typeof first === 'object' &&
		'type' in first &&
		first.type === 'text' &&
		'text' in first &&
		typeof first.text === 'string'
	) {
		return first.text;
	}
	throw new Error('expected a text content block');
}

describe('braindance MCP server', () => {
	let dataDir: string;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), 'bd-mcp-server-'));
		const registry = await openRegistry(dataDir);
		const project = await createProject(dataDir, registry, 'Demo');
		await createTopic(project.db, { name: 'Demo Topic' });
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	it('registers list_projects, list_topics, read_kb tools', async () => {
		const server = await createBraindanceMcpServer({ dataDir });
		const [clientT, serverT] = InMemoryTransport.createLinkedPair();
		await server.connect(serverT);
		const client = new Client({ name: 'test', version: '0.0.1' });
		await client.connect(clientT);

		const { tools } = await client.listTools();
		const names = tools.map((t) => t.name).sort();
		expect(names).toEqual(['list_projects', 'list_topics', 'read_kb']);

		await client.close();
		await server.close();
	});

	it('list_projects returns registered projects via MCP call', async () => {
		const server = await createBraindanceMcpServer({ dataDir });
		const [clientT, serverT] = InMemoryTransport.createLinkedPair();
		await server.connect(serverT);
		const client = new Client({ name: 'test', version: '0.0.1' });
		await client.connect(clientT);

		const result = await client.callTool({ name: 'list_projects', arguments: {} });
		const parsed = JSON.parse(firstTextBlock(result.content)) as Array<{ name: string }>;
		expect(parsed).toHaveLength(1);
		expect(parsed[0].name).toBe('Demo');

		await client.close();
		await server.close();
	});

	it('list_topics returns topics for a valid project_id via MCP call', async () => {
		const server = await createBraindanceMcpServer({ dataDir });
		const [clientT, serverT] = InMemoryTransport.createLinkedPair();
		await server.connect(serverT);
		const client = new Client({ name: 'test', version: '0.0.1' });
		await client.connect(clientT);

		const projects = JSON.parse(
			firstTextBlock(
				(await client.callTool({ name: 'list_projects', arguments: {} })).content
			)
		) as Array<{ id: string }>;

		const result = await client.callTool({
			name: 'list_topics',
			arguments: { project_id: projects[0].id }
		});
		const topics = JSON.parse(firstTextBlock(result.content)) as Array<{ name: string }>;
		expect(topics).toHaveLength(1);
		expect(topics[0].name).toBe('Demo Topic');

		await client.close();
		await server.close();
	});

	it('surfaces a tool error when calling an unknown tool', async () => {
		const server = await createBraindanceMcpServer({ dataDir });
		const [clientT, serverT] = InMemoryTransport.createLinkedPair();
		await server.connect(serverT);
		const client = new Client({ name: 'test', version: '0.0.1' });
		await client.connect(clientT);

		await expect(
			client.callTool({ name: 'nonexistent', arguments: {} })
		).rejects.toThrow();

		await client.close();
		await server.close();
	});
});
