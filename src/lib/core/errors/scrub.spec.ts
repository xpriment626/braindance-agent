import { describe, it, expect } from 'vitest';
import { scrub } from './scrub';

describe('scrub', () => {
	it('redacts api_key=value patterns (multiple casings)', () => {
		expect(scrub('api_key=sk-abc123xyz')).toBe('api_key=[REDACTED]');
		expect(scrub('API_KEY: sk-abc123xyz')).toBe('API_KEY=[REDACTED]');
		expect(scrub('api-key  =  sk-abc123xyz')).toBe('api-key=[REDACTED]');
	});

	it('redacts bearer tokens', () => {
		expect(scrub('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.foo.bar')).toBe(
			'Authorization: [REDACTED]'
		);
		expect(scrub('bearer abc123')).toBe('bearer=[REDACTED]');
	});

	it('redacts sk-style provider keys regardless of context', () => {
		expect(scrub('failed with key sk-proj-abcdefghijklmnopqrstuv in body')).toBe(
			'failed with key [REDACTED-KEY] in body'
		);
	});

	it('preserves messages that contain no sensitive data', () => {
		expect(scrub('topic "abc" not found')).toBe('topic "abc" not found');
		expect(scrub('Discover agent stopped without calling report_findings')).toBe(
			'Discover agent stopped without calling report_findings'
		);
	});

	it('truncates messages longer than 1000 chars with marker', () => {
		const long = 'x'.repeat(2000);
		const result = scrub(long);
		expect(result.length).toBeLessThanOrEqual(1000 + '… [truncated]'.length);
		expect(result.endsWith('… [truncated]')).toBe(true);
		expect(result.startsWith('x'.repeat(1000))).toBe(true);
	});

	it('does not truncate messages at or below 1000 chars', () => {
		const exact = 'y'.repeat(1000);
		expect(scrub(exact)).toBe(exact);
		const under = 'z'.repeat(500);
		expect(scrub(under)).toBe(under);
	});

	it('applies truncation after redaction', () => {
		// Redaction should happen first so a long key embedded in a long string
		// still gets redacted before the truncation marker is appended.
		const msg = 'prefix '.repeat(200) + 'sk-aaaaaaaaaaaaaaaaaaaaaaaaaaa';
		const result = scrub(msg);
		expect(result).not.toContain('sk-aaaaaaaaaaaa');
	});
});
