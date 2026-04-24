import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import { openRegistry } from '../projects/project';
import { listProjectsHandler } from './tools/listProjects';
import { listTopicsHandler } from './tools/listTopics';
import { readKbHandler, type ContentMode } from './tools/readKb';

export interface ServerOptions {
	dataDir: string;
}

export async function createBraindanceMcpServer(opts: ServerOptions): Promise<Server> {
	const registryDb = await openRegistry(opts.dataDir);

	const server = new Server(
		{ name: 'braindance', version: '0.0.1' },
		{ capabilities: { tools: {} } }
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: [
			{
				name: 'list_projects',
				description: 'List all Braindance projects on this install.',
				inputSchema: { type: 'object', properties: {} }
			},
			{
				name: 'list_topics',
				description: 'List all topics in a project.',
				inputSchema: {
					type: 'object',
					properties: {
						project_id: { type: 'string' }
					},
					required: ['project_id']
				}
			},
			{
				name: 'read_kb',
				description:
					'Read sources from a project, optionally scoped to a topic. content_mode controls payload size: "full" returns complete content (default), "summary" returns the first 300 chars, "none" omits content entirely.',
				inputSchema: {
					type: 'object',
					properties: {
						project_id: { type: 'string' },
						topic_id: { type: 'string' },
						limit: { type: 'number' },
						content_mode: { type: 'string', enum: ['full', 'summary', 'none'] }
					},
					required: ['project_id']
				}
			}
		]
	}));

	server.setRequestHandler(CallToolRequestSchema, async (req) => {
		const { name } = req.params;
		const args = (req.params.arguments ?? {}) as Record<string, unknown>;
		const result = await dispatch(name, args, opts.dataDir, registryDb);
		return { content: [{ type: 'text', text: JSON.stringify(result) }] };
	});

	return server;
}

async function dispatch(
	name: string,
	args: Record<string, unknown>,
	dataDir: string,
	registryDb: Awaited<ReturnType<typeof openRegistry>>
): Promise<unknown> {
	switch (name) {
		case 'list_projects':
			return listProjectsHandler({ registryDb });
		case 'list_topics': {
			const projectId = asString(args.project_id);
			if (!projectId) throw new Error('list_topics requires project_id');
			return listTopicsHandler({ dataDir, registryDb, projectId });
		}
		case 'read_kb': {
			const projectId = asString(args.project_id);
			if (!projectId) throw new Error('read_kb requires project_id');
			return readKbHandler({
				dataDir,
				registryDb,
				projectId,
				topicId: asString(args.topic_id),
				limit: asNumber(args.limit),
				contentMode: asContentMode(args.content_mode)
			});
		}
		default:
			throw new Error(`unknown tool: ${name}`);
	}
}

function asString(v: unknown): string | undefined {
	return typeof v === 'string' ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
	return typeof v === 'number' ? v : undefined;
}

function asContentMode(v: unknown): ContentMode | undefined {
	if (v === 'full' || v === 'summary' || v === 'none') return v;
	return undefined;
}
