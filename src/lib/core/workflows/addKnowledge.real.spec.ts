/**
 * Gated real-provider smoke test for add_knowledge.
 *
 * Skipped unless RUN_REAL_SMOKE=1 AND both OPENROUTER_API_KEY + EXA_API_KEY
 * are set. Hits real OpenRouter (Kimi K2.6 by default) and the real Exa MCP
 * server (spawned via `npx -y exa-mcp-server`). Costs real tokens; do not
 * include in CI.
 *
 * Run locally:
 *   RUN_REAL_SMOKE=1 bun run test src/lib/core/workflows/addKnowledge.real.spec.ts
 *
 * Override the model:
 *   BRAINDANCE_SMOKE_MODEL='openai/gpt-5' RUN_REAL_SMOKE=1 bun run test ...
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createDb, type Database } from '../db/connection';
import { initProjectDb } from '../db/schema';
import { createTopic } from '../knowledge/topics';
import { openMcpClient, type ConnectedMcpClient } from '../mcp/client';
import { createWebChannel } from '../channels/web';
import { createOpenRouterProvider } from '../agents/openrouter';
import { addKnowledge } from './addKnowledge';
import { getDiscoveryReport } from '../knowledge/discovery-reports';
import { listSignalsByTopic } from '../knowledge/signals';

const SMOKE_ENABLED =
	process.env.RUN_REAL_SMOKE === '1' &&
	!!process.env.OPENROUTER_API_KEY &&
	!!process.env.EXA_API_KEY;

const TEN_MINUTES_MS = 10 * 60 * 1000;

describe.skipIf(!SMOKE_ENABLED)('addKnowledge — real-provider smoke', () => {
	let db: Database;
	let topicId: string;
	let mcp: ConnectedMcpClient;

	beforeAll(async () => {
		db = createDb(':memory:');
		await initProjectDb(db);
		const topic = await createTopic(db, {
			name: 'Model Context Protocol adoption',
			description: 'Tracking adoption of MCP across LLM toolchains.',
			guidance:
				'Prefer primary sources: spec docs, official announcements, integration guides.',
			narrativeThreads: ['mcp servers', 'integration patterns']
		});
		topicId = topic.id;

		const transport = new StdioClientTransport({
			command: 'npx',
			args: ['-y', 'exa-mcp-server'],
			env: {
				...process.env,
				EXA_API_KEY: process.env.EXA_API_KEY!
			} as Record<string, string>
		});
		mcp = await openMcpClient({ transport, name: 'exa-smoke' });
	}, TEN_MINUTES_MS);

	afterAll(async () => {
		if (mcp) await mcp.close();
	});

	it(
		'runs end-to-end against Kimi K2.6 + Exa, producing a pending discovery report and signals',
		async () => {
			const llm = createOpenRouterProvider({
				apiKey: process.env.OPENROUTER_API_KEY!,
				appName: 'braindance-smoke'
			});
			const channel = createWebChannel(mcp);

			const { discoveryReportId } = await addKnowledge(db, topicId, {
				llm,
				channels: [channel],
				config: {
					channels: { web: { enabled: true } },
					model: process.env.BRAINDANCE_SMOKE_MODEL ?? 'moonshotai/kimi-k2.6'
				}
			});

			const report = await getDiscoveryReport(db, discoveryReportId);
			expect(report).not.toBeNull();
			expect(report!.status).toBe('pending');
			expect(report!.newSources.length).toBeGreaterThan(0);
			for (const proposal of report!.newSources) {
				expect(proposal.status).toBe('pending');
				expect(proposal.title).toBeTruthy();
			}

			const signals = await listSignalsByTopic(db, topicId);
			// Real corpus is empty here, so audit may or may not raise signals.
			// Don't assert count — just assert that whatever it produced has the
			// expected shape.
			for (const signal of signals) {
				expect(signal.status).toBe('pending');
				expect(signal.raisedBy).toBe('audit');
			}

			// eslint-disable-next-line no-console
			console.log(
				`[smoke] discovery_report ${discoveryReportId}: ${report!.newSources.length} proposals, ${signals.length} signals`
			);
		},
		TEN_MINUTES_MS
	);
});
