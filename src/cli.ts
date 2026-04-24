#!/usr/bin/env node
import { getPlatformInfo, resolveDataDir } from './lib/core/paths';
import { serveMcpOverStdio } from './lib/core/mcp-server/stdio';

async function main(): Promise<void> {
	const [, , subcommand] = process.argv;
	const info = getPlatformInfo();
	const dataDir = resolveDataDir(info);

	switch (subcommand) {
		case 'mcp-serve':
			await serveMcpOverStdio({ dataDir });
			return;
		case '--version':
		case '-v':
			printVersion();
			return;
		case '--help':
		case '-h':
		case undefined:
			printUsage();
			return;
		default:
			console.error(`Unknown subcommand: ${subcommand}`);
			printUsage();
			process.exit(1);
	}
}

function printUsage(): void {
	console.error(`braindance — knowledge-first curation agent

Usage:
  braindance mcp-serve       Start the MCP server over stdio
  braindance --version       Print the installed version
  braindance --help          Show this message
`);
}

function printVersion(): void {
	// Replaced at build time if needed; for now, declared once.
	console.log('0.0.1');
}

main().catch((err) => {
	console.error(err instanceof Error ? err.stack ?? err.message : String(err));
	process.exit(1);
});
