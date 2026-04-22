import { basename, extname, join } from 'node:path';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import type { HandlerResult } from './types';

export async function handleFile(
	filePath: string,
	filesDir: string,
	sourceId: string
): Promise<HandlerResult> {
	const filename = basename(filePath);
	const ext = extname(filename);
	const content = await readFile(filePath, 'utf-8');

	// Copy original into files/{sourceId}/
	const destDir = join(filesDir, sourceId);
	await mkdir(destDir, { recursive: true });
	await copyFile(filePath, join(destDir, `original${ext}`));

	return {
		title: filename.replace(ext, ''),
		content,
		originalFormat: ext.slice(1), // strip leading dot
		rawPath: `${sourceId}/original${ext}`,
		provenance: `Uploaded: ${filename}`
	};
}
