import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
	validateUpload,
	materializeUpload,
	sanitizeFilename,
	MAX_UPLOAD_BYTES
} from './file-validation';
import { ValidationError } from '../../errors/types';

function makeFile(name: string, type: string, content: string | Uint8Array): File {
	if (typeof content === 'string') {
		return new File([content], name, { type });
	}
	// Copy into a fresh ArrayBuffer — TS narrows BlobPart to require
	// ArrayBuffer (not ArrayBufferLike), and Uint8Array.buffer is the latter
	// under newer lib defs. A copied buffer satisfies both runtime and types.
	const ab = new ArrayBuffer(content.byteLength);
	new Uint8Array(ab).set(content);
	return new File([ab], name, { type });
}

describe('validateUpload', () => {
	it('accepts .txt with text/plain', () => {
		const result = validateUpload(makeFile('notes.txt', 'text/plain', 'hello'));
		expect(result.ok).toBe(true);
	});

	it('accepts .md with text/markdown', () => {
		const result = validateUpload(makeFile('readme.md', 'text/markdown', '# hi'));
		expect(result.ok).toBe(true);
	});

	it('accepts .markdown with text/x-markdown', () => {
		const result = validateUpload(makeFile('post.markdown', 'text/x-markdown', '# hi'));
		expect(result.ok).toBe(true);
	});

	it('accepts .json with application/json', () => {
		const result = validateUpload(makeFile('data.json', 'application/json', '{}'));
		expect(result.ok).toBe(true);
	});

	it('accepts .md with empty MIME (macOS picker case)', () => {
		const result = validateUpload(makeFile('post.md', '', '# hi'));
		expect(result.ok).toBe(true);
	});

	it('rejects extension outside allowlist (mismatched MIME)', () => {
		const result = validateUpload(makeFile('script.exe', 'text/plain', 'fake'));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.kind).toBe('file-type-rejected');
	});

	it('rejects mismatched MIME even when extension is allowed', () => {
		const result = validateUpload(makeFile('post.md', 'image/png', 'PNG-fake'));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.kind).toBe('file-type-rejected');
	});

	it('rejects unknown extension with empty MIME', () => {
		const result = validateUpload(makeFile('binary.bin', '', 'whatever'));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.kind).toBe('file-type-rejected');
	});

	it('accepts a file at exactly the size cap', () => {
		const data = new Uint8Array(MAX_UPLOAD_BYTES);
		const result = validateUpload(makeFile('big.txt', 'text/plain', data));
		expect(result.ok).toBe(true);
	});

	it('rejects a file 1 byte over the size cap', () => {
		const data = new Uint8Array(MAX_UPLOAD_BYTES + 1);
		const result = validateUpload(makeFile('toobig.txt', 'text/plain', data));
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.kind).toBe('file-too-large');
	});
});

describe('sanitizeFilename', () => {
	it('keeps a normal filename intact', () => {
		expect(sanitizeFilename('notes.md')).toBe('notes.md');
	});

	it('strips path traversal segments via basename', () => {
		expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
	});

	it('replaces special characters with underscore', () => {
		expect(sanitizeFilename('weird:file?name.md')).toBe('weird_file_name.md');
	});

	it('truncates very long filenames', () => {
		const long = 'a'.repeat(500) + '.md';
		expect(sanitizeFilename(long).length).toBeLessThanOrEqual(200);
	});

	it('returns "upload" when sanitization leaves nothing', () => {
		expect(sanitizeFilename('///')).toBe('upload');
	});
});

describe('materializeUpload', () => {
	let testProjectPath: string;

	beforeEach(async () => {
		testProjectPath = await mkdtemp(join(tmpdir(), 'bd-upload-'));
	});

	afterEach(async () => {
		await rm(testProjectPath, { recursive: true, force: true });
	});

	it('writes the file under files/_uploads/ and returns its path', async () => {
		const file = makeFile('hello.md', 'text/markdown', '# Hello');
		const tempPath = await materializeUpload(file, testProjectPath);

		expect(tempPath).toContain(join('files', '_uploads'));
		expect(tempPath).toMatch(/-hello\.md$/);
		const content = await readFile(tempPath, 'utf-8');
		expect(content).toBe('# Hello');
	});

	it('sanitizes the filename in the temp path', async () => {
		const file = makeFile('../../etc/passwd', '', 'malicious');
		// File constructor will keep the name as-is; we sanitize on write.
		// But validation will reject this — wrap to confirm validation runs first.
		await expect(materializeUpload(file, testProjectPath)).rejects.toThrow(ValidationError);
	});

	it('throws ValidationError(file-too-large) for oversized uploads', async () => {
		const data = new Uint8Array(MAX_UPLOAD_BYTES + 1);
		const file = makeFile('big.txt', 'text/plain', data);
		await expect(materializeUpload(file, testProjectPath)).rejects.toMatchObject({
			name: 'ValidationError',
			kind: 'file-too-large'
		});
	});

	it('throws ValidationError(file-type-rejected) for bad MIME/ext', async () => {
		const file = makeFile('script.exe', 'application/octet-stream', 'fake');
		await expect(materializeUpload(file, testProjectPath)).rejects.toMatchObject({
			name: 'ValidationError',
			kind: 'file-type-rejected'
		});
	});

	it('writes raw bytes (binary safe)', async () => {
		// Even though we only allow text MIME types, the on-disk write itself
		// shouldn't corrupt bytes — handleFile reads as utf-8 later, but the
		// materialized file should be byte-identical to what came in.
		const bytes = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]); // "hello"
		const file = makeFile('hi.txt', 'text/plain', bytes);
		const tempPath = await materializeUpload(file, testProjectPath);
		const written = await readFile(tempPath);
		expect(Array.from(written)).toEqual(Array.from(bytes));
	});

	it('creates the _uploads directory if missing', async () => {
		const file = makeFile('first.md', 'text/markdown', 'hi');
		const tempPath = await materializeUpload(file, testProjectPath);
		const info = await stat(tempPath);
		expect(info.isFile()).toBe(true);
		expect(info.size).toBe(2);
	});
});
