import { eq } from 'drizzle-orm';
import { appSettings } from '../db/registry-schema';
import type { Database } from '../db/connection';

// User-scoped app settings persisted in the registry DB. Single row per key,
// last-write-wins. Saving `null` for a value deletes the row (the resolver
// then falls back to .env / built-in defaults).

export interface AppSettings {
	openrouter_api_key?: string;
	exa_api_key?: string;
	default_model?: string;
}

export type AppSettingKey = keyof AppSettings;

const KNOWN_KEYS: readonly AppSettingKey[] = [
	'openrouter_api_key',
	'exa_api_key',
	'default_model'
];

export async function loadSettings(db: Database): Promise<AppSettings> {
	const rows = await db.select().from(appSettings);
	const out: AppSettings = {};
	for (const row of rows) {
		if ((KNOWN_KEYS as readonly string[]).includes(row.key)) {
			out[row.key as AppSettingKey] = row.value;
		}
	}
	return out;
}

export async function saveSetting(
	db: Database,
	key: AppSettingKey,
	value: string | null
): Promise<void> {
	if (value === null) {
		await db.delete(appSettings).where(eq(appSettings.key, key));
		return;
	}
	const now = new Date().toISOString();
	await db
		.insert(appSettings)
		.values({ key, value, updatedAt: now })
		.onConflictDoUpdate({
			target: appSettings.key,
			set: { value, updatedAt: now }
		});
}
