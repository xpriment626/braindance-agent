import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { fail } from '@sveltejs/kit';
import { resolveDataDir, getPlatformInfo } from '$lib/core/paths';
import { openRegistry } from '$lib/core/projects/project';
import { loadSettings, saveSetting } from '$lib/core/settings/load';
import { normalizeError } from '$lib/core/errors/normalize';

const MAX_VALUE = 256;

function maskKey(value: string): string {
	if (value.length <= 8) return '••••••••';
	return `${value.slice(0, 4)} •••• •••• ${value.slice(-4)}`;
}

export const load: PageServerLoad = async () => {
	const dataDir = resolveDataDir(getPlatformInfo());
	const registry = await openRegistry(dataDir);
	const settings = await loadSettings(registry);

	const envOpenRouterKey = process.env.OPENROUTER_API_KEY ?? null;
	const envExaKey = process.env.EXA_API_KEY ?? null;

	return {
		models: {
			openrouter_key_masked: settings.openrouter_api_key
				? maskKey(settings.openrouter_api_key)
				: envOpenRouterKey
					? maskKey(envOpenRouterKey)
					: null,
			openrouter_key_source: (settings.openrouter_api_key
				? 'settings'
				: envOpenRouterKey
					? 'env'
					: 'unset') as 'settings' | 'env' | 'unset',
			default_model: settings.default_model ?? null
		},
		webSearch: {
			exa_key_set: !!settings.exa_api_key,
			exa_key_source: (settings.exa_api_key
				? 'settings'
				: envExaKey
					? 'env'
					: 'unset') as 'settings' | 'env' | 'unset'
		}
	};
};

export const actions: Actions = {
	saveModels: async ({ request }: RequestEvent) => {
		const formData = await request.formData();
		const apiKey = String(formData.get('openrouter_api_key') ?? '').trim();
		const model = String(formData.get('default_model') ?? '').trim();

		if (apiKey.length > MAX_VALUE || model.length > MAX_VALUE) {
			return fail(400, {
				section: 'models',
				error: {
					code: 'VALIDATION_SETTINGS_TOO_LONG',
					message: `Values must be ${MAX_VALUE} characters or fewer.`
				}
			});
		}

		try {
			const dataDir = resolveDataDir(getPlatformInfo());
			const registry = await openRegistry(dataDir);
			await saveSetting(registry, 'openrouter_api_key', apiKey || null);
			await saveSetting(registry, 'default_model', model || null);
			return { ok: true, section: 'models' };
		} catch (e) {
			const normalized = normalizeError(e);
			return fail(500, {
				section: 'models',
				error: { code: normalized.code, message: normalized.message }
			});
		}
	},

	saveWebSearch: async ({ request }: RequestEvent) => {
		const formData = await request.formData();
		const apiKey = String(formData.get('exa_api_key') ?? '').trim();

		if (apiKey.length > MAX_VALUE) {
			return fail(400, {
				section: 'web-search',
				error: {
					code: 'VALIDATION_SETTINGS_TOO_LONG',
					message: `Value must be ${MAX_VALUE} characters or fewer.`
				}
			});
		}

		try {
			const dataDir = resolveDataDir(getPlatformInfo());
			const registry = await openRegistry(dataDir);
			await saveSetting(registry, 'exa_api_key', apiKey || null);
			return { ok: true, section: 'web-search' };
		} catch (e) {
			const normalized = normalizeError(e);
			return fail(500, {
				section: 'web-search',
				error: { code: normalized.code, message: normalized.message }
			});
		}
	}
};
