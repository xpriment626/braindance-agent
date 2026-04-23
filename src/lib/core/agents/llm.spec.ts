import { describe, it, expect } from 'vitest';
import {
	createMockProvider,
	textResponse,
	toolCallResponse,
	type ToolCall
} from './llm';

describe('LLM provider mock', () => {
	it('returns a single canned text response', async () => {
		const provider = createMockProvider(textResponse('Hello, world!'));
		const result = await provider.generate({
			model: 'test',
			system: 'You are a test.',
			messages: [{ role: 'user', content: 'say hi' }]
		});
		expect(result.text).toBe('Hello, world!');
		expect(result.toolCalls).toEqual([]);
		expect(result.stopReason).toBe('end_turn');
	});

	it('returns a tool-call response', async () => {
		const call: ToolCall = {
			id: 'call_1',
			name: 'submit_audit',
			input: { freshnessFlags: [], summary: 'looks good' }
		};
		const provider = createMockProvider(toolCallResponse([call]));
		const result = await provider.generate({
			model: 'test',
			system: '',
			messages: [{ role: 'user', content: 'audit' }]
		});
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0].name).toBe('submit_audit');
		expect(result.stopReason).toBe('tool_use');
	});

	it('cycles through sequenced responses and repeats the last one', async () => {
		const provider = createMockProvider(
			toolCallResponse([
				{ id: 'c1', name: 'search_web', input: { query: 'agents' } }
			]),
			textResponse('second'),
			textResponse('third-and-final')
		);

		const r1 = await provider.generate({ model: 'm', system: '', messages: [] });
		const r2 = await provider.generate({ model: 'm', system: '', messages: [] });
		const r3 = await provider.generate({ model: 'm', system: '', messages: [] });
		const r4 = await provider.generate({ model: 'm', system: '', messages: [] });

		expect(r1.toolCalls[0].name).toBe('search_web');
		expect(r2.text).toBe('second');
		expect(r3.text).toBe('third-and-final');
		// After exhaustion, repeats the last response.
		expect(r4.text).toBe('third-and-final');
	});

	it('records call history for assertions', async () => {
		const provider = createMockProvider(textResponse('ok'));
		await provider.generate({
			model: 'm',
			system: 'sys',
			messages: [{ role: 'user', content: 'p1' }]
		});
		await provider.generate({
			model: 'm',
			system: 'sys',
			messages: [{ role: 'user', content: 'p2' }]
		});
		expect(provider.calls).toHaveLength(2);
		expect(provider.calls[0].messages[0].content).toBe('p1');
		expect(provider.calls[1].messages[0].content).toBe('p2');
	});

	it('records tools parameter when agents pass it', async () => {
		const provider = createMockProvider(textResponse('ok'));
		await provider.generate({
			model: 'm',
			system: '',
			messages: [],
			tools: [
				{
					name: 'submit',
					description: 'final answer',
					inputSchema: { type: 'object', properties: {} }
				}
			]
		});
		expect(provider.calls[0].tools).toHaveLength(1);
		expect(provider.calls[0].tools![0].name).toBe('submit');
	});
});
