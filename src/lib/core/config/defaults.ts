import type { BraindanceConfig } from './types';

export const DEFAULT_CONFIG: BraindanceConfig = {
	providers: {},
	mcp_servers: {},
	channels: {},
	capabilities: {
		discover: { provider: 'anthropic', model: 'claude-haiku-4-5' },
		audit: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
		strategy: { provider: 'anthropic', model: 'claude-opus-4-7' },
		writer: { provider: 'anthropic', model: 'claude-sonnet-4-6' }
	}
};
