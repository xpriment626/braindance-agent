import type { ChannelConfig } from '../config/types';
import { ValidationError } from '../errors/types';

export interface RunChannelOverride {
	enabled?: boolean;
	params?: Record<string, unknown>;
}

export function resolveChannelSelection(
	global: Record<string, ChannelConfig>,
	run: Record<string, RunChannelOverride> | undefined
): Record<string, ChannelConfig> {
	if (!run) {
		return Object.fromEntries(
			Object.entries(global).filter(([, cfg]) => cfg.enabled)
		);
	}

	const out: Record<string, ChannelConfig> = {};
	for (const [name, override] of Object.entries(run)) {
		const globalCfg = global[name];
		if (!globalCfg) {
			throw new ValidationError(
				'config',
				`channel "${name}" not configured globally — add it to config.yaml before selecting per-run`
			);
		}
		if (!globalCfg.enabled) {
			throw new ValidationError(
				'config',
				`channel "${name}" is disabled globally — enable in config.yaml before selecting per-run`
			);
		}
		if (override.enabled === false) continue;
		out[name] = {
			...globalCfg,
			params: { ...(globalCfg.params ?? {}), ...(override.params ?? {}) }
		};
	}
	return out;
}
