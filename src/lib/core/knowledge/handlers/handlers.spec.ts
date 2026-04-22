import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { handleText } from './text';
import { handleFile } from './file';
import { handleUrl } from './url';
import type { UrlScraper } from './types';

describe('handleText', () => {
	it('returns content directly with auto-generated title', async () => {
		const result = await handleText('This is my research note about agent coordination.');
		expect(result.title).toBe('Text: This is my research note about agent coordination.');
		expect(result.content).toBe('This is my research note about agent coordination.');
		expect(result.originalFormat).toBe('text/plain');
		expect(result.provenance).toBe('Pasted text');
	});

	it('truncates title to 80 characters', async () => {
		const longText = 'A'.repeat(200);
		const result = await handleText(longText);
		expect(result.title).toBe(`Text: ${'A'.repeat(80)}`);
	});
});

describe('handleFile', () => {
	let tempDir: string;
	let filesDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'handler-test-'));
		filesDir = join(tempDir, 'files');
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it('reads file content and generates title from filename', async () => {
		const testFile = join(tempDir, 'research-notes.md');
		await writeFile(testFile, '# Notes\nSome content here');

		const result = await handleFile(testFile, filesDir, 'source-123');
		expect(result.title).toBe('research-notes');
		expect(result.content).toBe('# Notes\nSome content here');
		expect(result.originalFormat).toBe('md');
		expect(result.provenance).toBe('Uploaded: research-notes.md');
	});

	it('copies original file to files/{sourceId}/', async () => {
		const testFile = join(tempDir, 'paper.pdf');
		await writeFile(testFile, 'fake pdf content');

		const result = await handleFile(testFile, filesDir, 'source-456');
		expect(result.rawPath).toBe('source-456/original.pdf');

		const copiedPath = join(filesDir, 'source-456', 'original.pdf');
		await expect(access(copiedPath)).resolves.toBeUndefined();
		const copiedContent = await readFile(copiedPath, 'utf-8');
		expect(copiedContent).toBe('fake pdf content');
	});
});

describe('handleUrl', () => {
	it('scrapes URL and returns structured result', async () => {
		const mockScraper: UrlScraper = {
			scrape: async () => ({
				title: 'Test Article',
				content: 'Article body text here',
				metadata: { description: 'A test article' }
			})
		};

		const result = await handleUrl('https://example.com/article', mockScraper);
		expect(result.title).toBe('Test Article');
		expect(result.content).toBe('Article body text here');
		expect(result.originalFormat).toBe('text/html');
		expect(result.metadata?.sourceUrl).toBe('https://example.com/article');
		expect(result.provenance).toBe('Scraped: example.com');
	});

	it('falls back to hostname for title when scraper returns none', async () => {
		const mockScraper: UrlScraper = {
			scrape: async () => ({ content: 'Some content' })
		};

		const result = await handleUrl('https://blog.example.com/post', mockScraper);
		expect(result.title).toBe('blog.example.com');
	});
});
