// Runtime orchestrator — turns a resolved BraindanceConfig into the live
// dependencies a workflow needs (LLM provider, opened MCP-backed channels)
// plus a cleanup() that closes every MCP client when the workflow is done.
//
// Used by:
//   - SvelteKit form actions that trigger workflows
//   - The CLI (future), when it grows a `run` subcommand
//
// One MCP client is opened per unique mcp_server name across enabled channels;
// channels that share an MCP server (e.g. multiple Exa-backed channels) share
// the same client.

import type { BraindanceConfig } from './config/types';
import type { LLMProvider } from './agents/llm';
import type { Channel } from './channels/types';
import type { ConnectedMcpClient } from './mcp/client';
import { openFromConfig } from './mcp/client';
import { createOpenRouterProvider } from './agents/openrouter';
import { createWebChannel } from './channels/web';
import { createGithubChannel } from './channels/github';
import { createExaUrlScraper } from './channels/exa-url-scraper';
import type { UrlScraper } from './knowledge/handlers/types';
import { ValidationError } from './errors/types';

export interface Runtime {
	llm: LLMProvider;
	channels: Channel[];
	urlScraper: UrlScraper | null;
	cleanup: () => Promise<void>;
}

type ChannelFactory = (mcp: ConnectedMcpClient) => Channel;

const CHANNEL_FACTORIES: Record<string, ChannelFactory> = {
	web: createWebChannel,
	github: createGithubChannel
};

export async function buildRuntime(config: BraindanceConfig): Promise<Runtime> {
	const mcpClients = new Map<string, ConnectedMcpClient>();
	const channels: Channel[] = [];
	let urlScraper: UrlScraper | null = null;

	const cleanup = async (): Promise<void> => {
		for (const client of mcpClients.values()) {
			try {
				await client.close();
			} catch {
				// Cleanup must never throw — partial close is acceptable.
			}
		}
	};

	try {
		// 1. Open MCP clients for every server referenced by an enabled channel.
		for (const [channelName, channelCfg] of Object.entries(config.channels)) {
			if (!channelCfg.enabled) continue;
			const mcpName = channelCfg.mcp_server;
			if (!mcpName) continue;
			if (mcpClients.has(mcpName)) continue;
			const mcpCfg = config.mcp_servers[mcpName];
			if (!mcpCfg) {
				throw new ValidationError(
					'config',
					`channel "${channelName}" references mcp_server "${mcpName}" which is not configured`
				);
			}
			mcpClients.set(mcpName, await openFromConfig(mcpName, mcpCfg));
		}

		// 2. Construct channels from enabled config entries.
		for (const [channelName, channelCfg] of Object.entries(config.channels)) {
			if (!channelCfg.enabled) continue;
			const factory = CHANNEL_FACTORIES[channelName];
			if (!factory) continue; // unknown channel name — skip silently for forward-compat
			if (!channelCfg.mcp_server) continue;
			const mcp = mcpClients.get(channelCfg.mcp_server);
			if (!mcp) continue;
			channels.push(factory(mcp));
		}

		// 3. URL scraper — wired to the same MCP that powers the `web` channel
		// (Exa). Nullable so non-web setups still work.
		const webMcpName = config.channels.web?.mcp_server;
		if (webMcpName) {
			const webMcp = mcpClients.get(webMcpName);
			if (webMcp) urlScraper = createExaUrlScraper(webMcp);
		}

		// 4. LLM provider — uses the discover capability's provider config.
		// All three capabilities share the same provider in MVP. (Multi-provider
		// per capability is post-beta.)
		const discoverCap = config.capabilities.discover;
		const provider = config.providers[discoverCap.provider];
		if (!provider) {
			throw new ValidationError(
				'config',
				`provider "${discoverCap.provider}" not configured (referenced by capabilities.discover)`
			);
		}
		const apiKey = provider.api_key ?? process.env.OPENROUTER_API_KEY;
		if (!apiKey) {
			throw new ValidationError(
				'config',
				'OpenRouter API key is not set. Add it under Settings → Models.'
			);
		}
		const llm = createOpenRouterProvider({
			apiKey,
			baseUrl: provider.base_url,
			appName: 'braindance'
		});

		return { llm, channels, urlScraper, cleanup };
	} catch (e) {
		// Anything thrown above (incl. MCP transport failure on connect) leaves
		// already-opened clients dangling — close them before propagating.
		await cleanup();
		throw e;
	}
}
