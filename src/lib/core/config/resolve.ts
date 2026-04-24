import { DEFAULT_CONFIG } from './defaults';
import type {
	BraindanceConfig,
	CapabilityConfig,
	ChannelConfig,
	McpServerConfig,
	PartialBraindanceConfig,
	ProviderConfig
} from './types';

export interface ResolveInput {
	user?: PartialBraindanceConfig | null;
	project?: PartialBraindanceConfig | null;
	run?: PartialBraindanceConfig | null;
}

type CapabilityName = keyof BraindanceConfig['capabilities'];

export function resolveConfig(input: ResolveInput): BraindanceConfig {
	// Order lowest → highest priority
	const layers: PartialBraindanceConfig[] = [
		input.user,
		input.project,
		input.run
	].filter((l): l is PartialBraindanceConfig => l != null);

	return {
		providers: mergeEntries<ProviderConfig>(layers, 'providers'),
		mcp_servers: mergeEntries<McpServerConfig>(layers, 'mcp_servers'),
		channels: mergeEntries<ChannelConfig>(layers, 'channels'),
		capabilities: {
			discover: mergeCapability(layers, 'discover'),
			audit: mergeCapability(layers, 'audit'),
			prune: mergeCapability(layers, 'prune')
		}
	};
}

function mergeEntries<T extends object>(
	layers: PartialBraindanceConfig[],
	key: 'providers' | 'mcp_servers' | 'channels'
): Record<string, T> {
	const out: Record<string, T> = {};
	for (const layer of layers) {
		const entries = layer[key] as Record<string, T> | undefined;
		if (!entries) continue;
		for (const [k, v] of Object.entries(entries)) {
			// Shallow-merge within the entry: later layers override fields of earlier layers
			out[k] = { ...((out[k] as object) ?? {}), ...(v as object) } as T;
		}
	}
	return out;
}

function mergeCapability(
	layers: PartialBraindanceConfig[],
	name: CapabilityName
): CapabilityConfig {
	let merged: CapabilityConfig = { ...DEFAULT_CONFIG.capabilities[name] };
	for (const layer of layers) {
		const cap = layer.capabilities?.[name];
		if (cap) merged = { ...merged, ...cap };
	}
	return merged;
}
