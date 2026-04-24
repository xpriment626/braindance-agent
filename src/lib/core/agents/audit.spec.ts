import { describe, it, expect } from 'vitest';
import { createMockProvider, textResponse, toolCallResponse } from './llm';
import { runAudit } from './audit';
import type { AuditInput, AuditOutput } from './types';

const baseInput: AuditInput = {
	topic: {
		id: 'topic-1',
		name: 'Agent Protocols',
		description: 'Research on agent coordination',
		guidance: 'Focus on open standards',
		narrativeThreads: ['MCP', 'A2A']
	},
	corpus: [
		{
			id: 'src-1',
			title: 'MCP Overview',
			type: 'url',
			content: 'MCP is a protocol for...',
			originalUrl: 'https://example.com/mcp',
			metadata: null,
			createdAt: '2025-06-01T00:00:00Z'
		},
		{
			id: 'src-2',
			title: 'A2A Spec',
			type: 'url',
			content: 'Agent-to-Agent protocol...',
			originalUrl: 'https://example.com/a2a',
			metadata: null,
			createdAt: '2026-01-15T00:00:00Z'
		}
	]
};

function submitAuditCall(id: string, output: AuditOutput) {
	return toolCallResponse([
		{ id, name: 'submit_audit', input: output as unknown as Record<string, unknown> }
	]);
}

describe('runAudit', () => {
	it('returns structured audit report parsed from submit_audit tool call', async () => {
		const mockOutput: AuditOutput = {
			freshnessFlags: [
				{ targetId: 'src-1', signalType: 'stale', reason: 'Published 10 months ago' }
			],
			contradictions: [],
			gapAnalysis: [
				{ thread: 'MCP', coverage: 'strong', notes: 'Good coverage' },
				{ thread: 'A2A', coverage: 'thin', notes: 'Only one source' }
			],
			consolidationSuggestions: [],
			summary: 'Corpus has good MCP coverage but thin A2A coverage.'
		};
		const provider = createMockProvider(submitAuditCall('call-1', mockOutput));
		const output = await runAudit(provider, baseInput);
		expect(output.freshnessFlags).toHaveLength(1);
		expect(output.freshnessFlags[0].signalType).toBe('stale');
		expect(output.gapAnalysis).toHaveLength(2);
		expect(output.summary).toBeTruthy();
	});

	it('includes all corpus sources in the user turn', async () => {
		const provider = createMockProvider(
			submitAuditCall('call-1', {
				freshnessFlags: [],
				contradictions: [],
				gapAnalysis: [],
				consolidationSuggestions: [],
				summary: 'ok'
			})
		);
		await runAudit(provider, baseInput);
		const firstUserMessage = provider.calls[0].messages.find((m) => m.role === 'user');
		expect(firstUserMessage?.content).toContain('MCP Overview');
		expect(firstUserMessage?.content).toContain('A2A Spec');
	});

	it('handles an empty corpus', async () => {
		const provider = createMockProvider(
			submitAuditCall('call-1', {
				freshnessFlags: [],
				contradictions: [],
				gapAnalysis: [{ thread: 'MCP', coverage: 'missing', notes: 'No sources' }],
				consolidationSuggestions: [],
				summary: 'Empty corpus'
			})
		);
		const output = await runAudit(provider, { ...baseInput, corpus: [] });
		expect(output.gapAnalysis[0].coverage).toBe('missing');
	});

	it('throws when the LLM returns text without calling submit_audit (within maxIterations)', async () => {
		const provider = createMockProvider(textResponse('I cannot audit this.'));
		await expect(runAudit(provider, baseInput, { maxIterations: 2 })).rejects.toThrow(
			/submit_audit/
		);
	});

	it('re-prompts after a tool call that is not submit_audit, then succeeds', async () => {
		const validOutput: AuditOutput = {
			freshnessFlags: [],
			contradictions: [],
			gapAnalysis: [],
			consolidationSuggestions: [],
			summary: 'ok'
		};
		const provider = createMockProvider(
			toolCallResponse([
				{ id: 'call-0', name: 'bogus_tool', input: {} }
			]),
			submitAuditCall('call-1', validOutput)
		);
		const output = await runAudit(provider, baseInput);
		expect(output.summary).toBe('ok');
	});
});
