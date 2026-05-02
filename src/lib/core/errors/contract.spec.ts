import { describe, it, expect } from 'vitest';
import {
	serializeWorkflowRunError,
	parseWorkflowRunError,
	isValidWorkflowRunError,
	type WorkflowRunError
} from './contract';

describe('contract serialize/parse', () => {
	it('round-trips a minimal error', () => {
		const err: WorkflowRunError = {
			category: 'validation',
			code: 'VALIDATION_TOPIC_NOT_FOUND',
			message: 'topic "abc" not found'
		};
		const round = parseWorkflowRunError(serializeWorkflowRunError(err));
		expect(round).toEqual(err);
	});

	it('round-trips a full error with all optional fields', () => {
		const err: WorkflowRunError = {
			category: 'transient',
			code: 'OPENROUTER_RATE_LIMITED',
			message: 'OpenRouter request failed: 429 Too Many Requests',
			agent: 'discover',
			source: { kind: 'llm', name: 'openrouter', statusCode: 429 },
			hint: 'Wait a moment and retry'
		};
		const round = parseWorkflowRunError(serializeWorkflowRunError(err));
		expect(round).toEqual(err);
	});

	it('returns null for null input', () => {
		expect(parseWorkflowRunError(null)).toBeNull();
	});

	it('wraps a legacy free-form string as INTERNAL fatal', () => {
		const result = parseWorkflowRunError('some legacy error message');
		expect(result).toEqual({
			category: 'fatal',
			code: 'INTERNAL',
			message: 'some legacy error message'
		});
	});

	it('wraps non-JSON gibberish as INTERNAL fatal preserving original', () => {
		const result = parseWorkflowRunError('not valid json {{{');
		expect(result).toEqual({
			category: 'fatal',
			code: 'INTERNAL',
			message: 'not valid json {{{'
		});
	});

	it('wraps JSON that does not match the contract shape as INTERNAL fatal', () => {
		// Valid JSON but missing required fields — could be partial / legacy.
		const result = parseWorkflowRunError(JSON.stringify({ foo: 'bar' }));
		expect(result).toEqual({
			category: 'fatal',
			code: 'INTERNAL',
			message: JSON.stringify({ foo: 'bar' })
		});
	});
});

describe('isValidWorkflowRunError', () => {
	it('accepts a minimal valid error', () => {
		expect(
			isValidWorkflowRunError({
				category: 'validation',
				code: 'VALIDATION_TOPIC_NOT_FOUND',
				message: 'topic not found'
			})
		).toBe(true);
	});

	it('accepts a full valid error', () => {
		expect(
			isValidWorkflowRunError({
				category: 'transient',
				code: 'OPENROUTER_UPSTREAM',
				message: 'upstream failure',
				agent: 'audit',
				source: { kind: 'llm', name: 'openrouter', statusCode: 502 },
				hint: 'try again'
			})
		).toBe(true);
	});

	it('rejects unknown category', () => {
		expect(
			isValidWorkflowRunError({
				category: 'unknown',
				code: 'X',
				message: 'y'
			})
		).toBe(false);
	});

	it('rejects missing required field', () => {
		expect(isValidWorkflowRunError({ category: 'validation', message: 'no code' })).toBe(false);
		expect(isValidWorkflowRunError({ category: 'validation', code: 'X' })).toBe(false);
	});

	it('rejects invalid agent name', () => {
		expect(
			isValidWorkflowRunError({
				category: 'agent',
				code: 'AGENT_ITERATION_LIMIT',
				message: 'x',
				agent: 'unknown-agent'
			})
		).toBe(false);
	});

	it('rejects invalid source.kind', () => {
		expect(
			isValidWorkflowRunError({
				category: 'transient',
				code: 'X',
				message: 'y',
				source: { kind: 'database', name: 'x' }
			})
		).toBe(false);
	});

	it('rejects non-object input', () => {
		expect(isValidWorkflowRunError(null)).toBe(false);
		expect(isValidWorkflowRunError('string')).toBe(false);
		expect(isValidWorkflowRunError(42)).toBe(false);
		expect(isValidWorkflowRunError([])).toBe(false);
	});
});
