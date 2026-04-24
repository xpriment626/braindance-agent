export interface ProviderConfig {
	api_key?: string;
	base_url?: string;
}

export interface McpServerConfig {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
}

export interface ChannelConfig {
	enabled: boolean;
	mcp_server?: string;
	params?: Record<string, unknown>;
}

export interface CapabilityConfig {
	provider: string;
	model: string;
}

export interface BraindanceConfig {
	providers: Record<string, ProviderConfig>;
	mcp_servers: Record<string, McpServerConfig>;
	channels: Record<string, ChannelConfig>;
	capabilities: {
		discover: CapabilityConfig;
		audit: CapabilityConfig;
		prune: CapabilityConfig;
	};
}

export interface PartialBraindanceConfig {
	providers?: Record<string, ProviderConfig>;
	mcp_servers?: Record<string, McpServerConfig>;
	channels?: Record<string, ChannelConfig>;
	capabilities?: {
		discover?: Partial<CapabilityConfig>;
		audit?: Partial<CapabilityConfig>;
		prune?: Partial<CapabilityConfig>;
	};
}
