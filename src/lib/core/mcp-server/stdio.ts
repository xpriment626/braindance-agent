import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBraindanceMcpServer, type ServerOptions } from './server';

export async function serveMcpOverStdio(opts: ServerOptions): Promise<void> {
	const server = await createBraindanceMcpServer(opts);
	const transport = new StdioServerTransport();
	await server.connect(transport);
}
