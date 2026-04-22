import { describe, it, expect } from 'vitest';
import { detectInputType } from './detect';

describe('detectInputType', () => {
	it('detects YouTube URLs', () => {
		expect(detectInputType('https://www.youtube.com/watch?v=abc123')).toBe('youtube');
		expect(detectInputType('https://youtu.be/abc123')).toBe('youtube');
	});

	it('detects Tweet/X URLs', () => {
		expect(detectInputType('https://twitter.com/user/status/123')).toBe('tweet');
		expect(detectInputType('https://x.com/user/status/123')).toBe('tweet');
	});

	it('detects general URLs', () => {
		expect(detectInputType('https://example.com/article')).toBe('url');
		expect(detectInputType('http://blog.example.com/post')).toBe('url');
	});

	it('defaults to text for non-URL strings', () => {
		expect(detectInputType('Just some raw text')).toBe('text');
		expect(detectInputType('Notes about a topic I want to track')).toBe('text');
	});

	it('detects text for empty or whitespace strings', () => {
		expect(detectInputType('')).toBe('text');
		expect(detectInputType('   ')).toBe('text');
	});
});
