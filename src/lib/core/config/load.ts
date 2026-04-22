import { join } from 'node:path';
import { readFile, writeFile, chmod, mkdir } from 'node:fs/promises';
import { parse, stringify } from 'yaml';
import type { PartialBraindanceConfig } from './types';

export async function loadConfig(configDir: string): Promise<PartialBraindanceConfig | null> {
	const path = join(configDir, 'config.yaml');
	let text: string;
	try {
		text = await readFile(path, 'utf-8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw err;
	}

	const parsed = parse(text);
	if (parsed === null || parsed === undefined) return null;
	if (typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error(`config.yaml must be an object at top level, got ${typeof parsed}`);
	}
	return parsed as PartialBraindanceConfig;
}

export async function writeConfig(
	configDir: string,
	config: PartialBraindanceConfig
): Promise<void> {
	await mkdir(configDir, { recursive: true });
	const path = join(configDir, 'config.yaml');
	await writeFile(path, stringify(config));
	if (process.platform !== 'win32') {
		await chmod(path, 0o600);
	}
}
