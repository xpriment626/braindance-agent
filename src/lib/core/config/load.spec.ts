import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { loadConfig, writeConfig } from './load';

describe('loadConfig', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'bd-config-test-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('returns null when config.yaml missing', async () => {
		const result = await loadConfig(dir);
		expect(result).toBeNull();
	});

	it('reads valid config.yaml', async () => {
		await writeFile(
			join(dir, 'config.yaml'),
			`
providers:
  anthropic:
    api_key: sk-ant-test
channels:
  web:
    enabled: true
    mcp_server: exa
`
		);
		const result = await loadConfig(dir);
		expect(result?.providers?.anthropic?.api_key).toBe('sk-ant-test');
		expect(result?.channels?.web?.enabled).toBe(true);
	});

	it('returns null for empty config.yaml', async () => {
		await writeFile(join(dir, 'config.yaml'), '');
		const result = await loadConfig(dir);
		expect(result).toBeNull();
	});

	it('throws on invalid YAML', async () => {
		await writeFile(join(dir, 'config.yaml'), '  - : : invalid\n  [unclosed');
		await expect(loadConfig(dir)).rejects.toThrow();
	});

	it('throws when yaml top-level is not an object', async () => {
		await writeFile(join(dir, 'config.yaml'), '42');
		await expect(loadConfig(dir)).rejects.toThrow(/object/);
	});
});

describe('writeConfig', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'bd-config-test-'));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('creates config.yaml with chmod 600 on first write', async () => {
		await writeConfig(dir, {
			providers: { anthropic: { api_key: 'sk-ant-x' } }
		});
		const stats = await stat(join(dir, 'config.yaml'));
		if (process.platform !== 'win32') {
			const mode = stats.mode & 0o777;
			expect(mode).toBe(0o600);
		}
	});

	it('creates the config dir if missing', async () => {
		const nested = join(dir, 'nested', 'path');
		await writeConfig(nested, { providers: {} });
		const stats = await stat(join(nested, 'config.yaml'));
		expect(stats.isFile()).toBe(true);
	});

	it('round-trips through load', async () => {
		await writeConfig(dir, {
			providers: { anthropic: { api_key: 'sk-ant-round' } },
			channels: { web: { enabled: true, mcp_server: 'exa' } }
		});
		const loaded = await loadConfig(dir);
		expect(loaded?.providers?.anthropic?.api_key).toBe('sk-ant-round');
		expect(loaded?.channels?.web?.mcp_server).toBe('exa');
	});
});
