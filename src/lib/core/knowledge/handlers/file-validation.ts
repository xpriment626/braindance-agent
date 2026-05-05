import { basename, extname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { generateId } from '../../db/id';
import { ValidationError, type ValidationKind } from '../../errors/types';

// Validation + materialization for File objects coming in via multipart form
// uploads. Browsers don't always set Content-Type accurately (macOS file picker
// frequently sends empty MIME for .md), so the extension is the load-bearing
// check; MIME is treated as a hint that, if present, must match the allowlist.

export const ALLOWED_MIME = new Set<string>([
	'text/plain',
	'text/markdown',
	'text/x-markdown',
	'application/json'
]);

export const ALLOWED_EXTENSIONS = new Set<string>(['.txt', '.md', '.markdown', '.json']);

export const MAX_UPLOAD_BYTES = 1024 * 1024; // 1 MB

export interface UploadValidationOk {
	ok: true;
}

export interface UploadValidationFailure {
	ok: false;
	kind: Extract<ValidationKind, 'file-type-rejected' | 'file-too-large'>;
	message: string;
}

export type UploadValidationResult = UploadValidationOk | UploadValidationFailure;

export function validateUpload(file: File): UploadValidationResult {
	if (file.size > MAX_UPLOAD_BYTES) {
		return {
			ok: false,
			kind: 'file-too-large',
			message: 'File too large — limit is 1 MB.'
		};
	}
	const ext = extname(file.name).toLowerCase();
	const extOk = ALLOWED_EXTENSIONS.has(ext);
	// MIME may carry parameters like `;charset=utf-8` (bun's File ctor adds
	// these for text content). Strip everything after the first `;` and trim.
	const mimeBase = file.type.split(';', 1)[0].trim().toLowerCase();
	// Empty MIME is allowed iff extension matches (some browsers / pickers
	// don't set Content-Type for text-ish files). A non-empty MIME must be
	// in the allowlist.
	const mimeOk = mimeBase === '' ? extOk : ALLOWED_MIME.has(mimeBase);
	if (!mimeOk || !extOk) {
		return {
			ok: false,
			kind: 'file-type-rejected',
			message: 'Only text files are supported (.txt, .md, .markdown, .json).'
		};
	}
	return { ok: true };
}

export function sanitizeFilename(name: string): string {
	// Strip path components first so traversal attempts ("../etc/passwd") collapse
	// to just "passwd". Then drop anything that isn't word chars / dot / dash /
	// space, and cap length so a 5000-char filename can't blow up the path.
	return basename(name).replace(/[^\w.\- ]/g, '_').slice(0, 200) || 'upload';
}

// Writes the upload to `{projectPath}/files/_uploads/{tempId}-{safeName}` and
// returns the absolute path. The caller is responsible for unlinking the temp
// path after the briefing-card pipeline is done with it (the existing
// handleFile copies to its own files/{sourceId}/ subdir, so the temp file is
// safe to delete once that copy completes).
export async function materializeUpload(
	file: File,
	projectPath: string
): Promise<string> {
	const validation = validateUpload(file);
	if (!validation.ok) {
		throw new ValidationError(validation.kind, validation.message);
	}

	const uploadsDir = join(projectPath, 'files', '_uploads');
	await mkdir(uploadsDir, { recursive: true });

	const tempId = generateId();
	const safeName = sanitizeFilename(file.name);
	const tempPath = join(uploadsDir, `${tempId}-${safeName}`);

	const buf = Buffer.from(await file.arrayBuffer());
	await writeFile(tempPath, buf);

	return tempPath;
}
