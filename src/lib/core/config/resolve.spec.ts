import { describe, it, expect } from 'vitest';
import { resolveConfig } from './resolve';

describe('resolveConfig', () => {
	it('returns defaults when no overrides', () => {
		const config = resolveConfig({});
		expect(config.capabilities.discover.provider).toBe('anthropic');
		expect(config.capabilities.discover.model).toBe('claude-haiku-4-5');
		expect(config.providers).toEqual({});
	});

	it('user config overrides defaults', () => {
		const config = resolveConfig({
			user: {
				capabilities: {
					discover: { provider: 'openai', model: 'gpt-5' }
				}
			}
		});
		expect(config.capabilities.discover.provider).toBe('openai');
		expect(config.capabilities.discover.model).toBe('gpt-5');
		expect(config.capabilities.audit.provider).toBe('anthropic');
	});

	it('project config overrides user config', () => {
		const config = resolveConfig({
			user: {
				capabilities: {
					discover: { provider: 'anthropic', model: 'claude-sonnet-4-6' }
				}
			},
			project: {
				capabilities: {
					discover: { provider: 'anthropic', model: 'claude-haiku-4-5' }
				}
			}
		});
		expect(config.capabilities.discover.model).toBe('claude-haiku-4-5');
	});

	it('run config overrides project config', () => {
		const config = resolveConfig({
			user: {
				capabilities: {
					writer: { provider: 'anthropic', model: 'claude-sonnet-4-6' }
				}
			},
			run: {
				capabilities: {
					writer: { provider: 'openai', model: 'gpt-5-mini' }
				}
			}
		});
		expect(config.capabilities.writer.provider).toBe('openai');
		expect(config.capabilities.writer.model).toBe('gpt-5-mini');
	});

	it('merges mcp_servers from user config', () => {
		const config = resolveConfig({
			user: {
				mcp_servers: {
					exa: { command: 'npx', args: ['-y', 'exa-mcp-server'] }
				}
			}
		});
		expect(config.mcp_servers.exa?.command).toBe('npx');
	});

	it('merges mcp_servers additively across layers', () => {
		const config = resolveConfig({
			user: { mcp_servers: { exa: { command: 'npx', args: ['exa-mcp-server'] } } },
			project: { mcp_servers: { firecrawl: { command: 'npx', args: ['firecrawl-mcp-server'] } } }
		});
		expect(config.mcp_servers.exa?.command).toBe('npx');
		expect(config.mcp_servers.firecrawl?.command).toBe('npx');
	});

	it('field-by-field merge within a capability block (partial override)', () => {
		const config = resolveConfig({
			user: {
				capabilities: {
					discover: { provider: 'openai', model: 'gpt-5' }
				}
			},
			run: {
				capabilities: {
					discover: { model: 'gpt-5-mini' }
				}
			}
		});
		expect(config.capabilities.discover.provider).toBe('openai');
		expect(config.capabilities.discover.model).toBe('gpt-5-mini');
	});

	it('same-key entry merge (run env overrides user env but preserves command)', () => {
		const config = resolveConfig({
			user: {
				mcp_servers: {
					exa: {
						command: 'npx',
						args: ['-y', 'exa-mcp-server'],
						env: { EXA_API_KEY: 'user-key' }
					}
				}
			},
			run: {
				mcp_servers: {
					exa: { env: { EXA_API_KEY: 'run-key' } }
				}
			}
		});
		expect(config.mcp_servers.exa?.command).toBe('npx');
		expect(config.mcp_servers.exa?.env?.EXA_API_KEY).toBe('run-key');
	});

	it('channels layer correctly', () => {
		const config = resolveConfig({
			user: {
				channels: {
					web: { enabled: true, mcp_server: 'exa' }
				}
			}
		});
		expect(config.channels.web?.enabled).toBe(true);
		expect(config.channels.web?.mcp_server).toBe('exa');
	});
});
