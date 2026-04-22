import { describe, it, expect } from 'vitest';
import { generateId } from './id';

describe('generateId', () => {
	it('returns a 26-character ULID string', () => {
		const id = generateId();
		expect(id).toHaveLength(26);
		expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
	});

	it('generates unique IDs', () => {
		const ids = new Set(Array.from({ length: 100 }, () => generateId()));
		expect(ids.size).toBe(100);
	});

	it('generates time-ordered IDs', () => {
		const id1 = generateId();
		const id2 = generateId();
		expect(id2 > id1).toBe(true);
	});
});
