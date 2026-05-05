import type { PartialBraindanceConfig } from '../config/types';
import type { AppSettings } from './load';

// Maps the AppSettings key/value store into a config layer that
// `resolveConfig` can merge between the user's config.yaml and any
// per-project overrides. Keys that are unset (undefined / empty string)
// produce no layer entry, so the lower-priority layers (user / defaults /
// .env-via-runtime) keep their current values.

export function settingsToConfigLayer(settings: AppSettings): PartialBraindanceConfig {
	const layer: PartialBraindanceConfig = {};

	if (settings.openrouter_api_key) {
		layer.providers = {
			openrouter: { api_key: settings.openrouter_api_key }
		};
	}

	if (settings.exa_api_key) {
		layer.mcp_servers = {
			exa: { env: { EXA_API_KEY: settings.exa_api_key } }
		};
	}

	if (settings.default_model) {
		layer.capabilities = {
			discover: { model: settings.default_model },
			audit: { model: settings.default_model },
			prune: { model: settings.default_model }
		};
	}

	return layer;
}
