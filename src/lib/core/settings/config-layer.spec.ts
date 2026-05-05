import { describe, it, expect } from 'vitest';
import { resolveConfig } from '../config/resolve';
import { settingsToConfigLayer } from './config-layer';

describe('settingsToConfigLayer', () => {
	it('returns an empty layer when no settings are set', () => {
		expect(settingsToConfigLayer({})).toEqual({});
	});

	it('emits providers.openrouter.api_key when set', () => {
		const layer = settingsToConfigLayer({ openrouter_api_key: 'sk-or-x' });
		expect(layer.providers?.openrouter?.api_key).toBe('sk-or-x');
		expect(layer.mcp_servers).toBeUndefined();
		expect(layer.capabilities).toBeUndefined();
	});

	it('emits mcp_servers.exa env when exa key is set', () => {
		const layer = settingsToConfigLayer({ exa_api_key: 'exa-key' });
		expect(layer.mcp_servers?.exa?.env?.EXA_API_KEY).toBe('exa-key');
	});

	it('threads default_model into all three capabilities', () => {
		const layer = settingsToConfigLayer({ default_model: 'foo/bar' });
		expect(layer.capabilities?.discover?.model).toBe('foo/bar');
		expect(layer.capabilities?.audit?.model).toBe('foo/bar');
		expect(layer.capabilities?.prune?.model).toBe('foo/bar');
	});
});

describe('settings layer integrates with resolveConfig', () => {
	it('overrides user config.yaml api_key with the settings value', () => {
		const resolved = resolveConfig({
			user: {
				providers: {
					openrouter: { api_key: 'from-yaml', base_url: 'https://x' }
				},
				capabilities: {
					discover: { provider: 'openrouter', model: 'a' },
					audit: { provider: 'openrouter', model: 'a' },
					prune: { provider: 'openrouter', model: 'a' }
				}
			},
			settings: settingsToConfigLayer({ openrouter_api_key: 'from-settings' })
		});
		expect(resolved.providers.openrouter.api_key).toBe('from-settings');
		// base_url from the user layer survives the shallow merge.
		expect(resolved.providers.openrouter.base_url).toBe('https://x');
	});

	it('settings model override beats user yaml model', () => {
		const resolved = resolveConfig({
			user: {
				capabilities: {
					discover: { provider: 'openrouter', model: 'yaml-model' }
				}
			},
			settings: settingsToConfigLayer({ default_model: 'settings-model' })
		});
		expect(resolved.capabilities.discover.model).toBe('settings-model');
	});

	it('project layer beats settings layer', () => {
		const resolved = resolveConfig({
			settings: settingsToConfigLayer({ default_model: 'settings-model' }),
			project: {
				capabilities: {
					discover: { provider: 'openrouter', model: 'project-model' }
				}
			}
		});
		expect(resolved.capabilities.discover.model).toBe('project-model');
	});

	it('settings exa key merges into existing user mcp_servers.exa entry', () => {
		const resolved = resolveConfig({
			user: {
				mcp_servers: {
					exa: { command: 'npx', args: ['-y', 'exa-mcp-server'] }
				}
			},
			settings: settingsToConfigLayer({ exa_api_key: 'exa-secret' })
		});
		expect(resolved.mcp_servers.exa.command).toBe('npx');
		expect(resolved.mcp_servers.exa.env?.EXA_API_KEY).toBe('exa-secret');
	});
});
