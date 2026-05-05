import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../db/connection';
import { initRegistryDb } from '../db/registry-schema';
import { loadSettings, saveSetting } from './load';

describe('app settings store', () => {
	let db: ReturnType<typeof createDb>;

	beforeEach(async () => {
		db = createDb(':memory:');
		await initRegistryDb(db);
	});

	describe('loadSettings', () => {
		it('returns an empty object on a fresh registry', async () => {
			const settings = await loadSettings(db);
			expect(settings).toEqual({});
		});

		it('returns persisted values keyed by name', async () => {
			await saveSetting(db, 'openrouter_api_key', 'sk-or-test');
			await saveSetting(db, 'default_model', 'moonshotai/kimi-k2.6');
			const settings = await loadSettings(db);
			expect(settings.openrouter_api_key).toBe('sk-or-test');
			expect(settings.default_model).toBe('moonshotai/kimi-k2.6');
			expect(settings.exa_api_key).toBeUndefined();
		});

		it('ignores unknown keys present in the table', async () => {
			// Simulate a future / stale key sitting in the table.
			const now = new Date().toISOString();
			await db
				.insert((await import('../db/registry-schema')).appSettings)
				.values({ key: 'future_setting', value: 'whatever', updatedAt: now });
			const settings = await loadSettings(db);
			expect(settings).toEqual({});
		});
	});

	describe('saveSetting', () => {
		it('inserts a new row', async () => {
			await saveSetting(db, 'openrouter_api_key', 'sk-or-1');
			const settings = await loadSettings(db);
			expect(settings.openrouter_api_key).toBe('sk-or-1');
		});

		it('updates an existing row in place (last-write-wins)', async () => {
			await saveSetting(db, 'openrouter_api_key', 'sk-or-1');
			await saveSetting(db, 'openrouter_api_key', 'sk-or-2');
			const settings = await loadSettings(db);
			expect(settings.openrouter_api_key).toBe('sk-or-2');
		});

		it('deletes the row when value is null', async () => {
			await saveSetting(db, 'exa_api_key', 'exa-key');
			await saveSetting(db, 'exa_api_key', null);
			const settings = await loadSettings(db);
			expect(settings.exa_api_key).toBeUndefined();
		});

		it('null on a missing row is a no-op (does not throw)', async () => {
			await expect(saveSetting(db, 'default_model', null)).resolves.toBeUndefined();
			const settings = await loadSettings(db);
			expect(settings.default_model).toBeUndefined();
		});

		it('refreshes updated_at on each write', async () => {
			await saveSetting(db, 'default_model', 'a');
			const { appSettings } = await import('../db/registry-schema');
			const first = await db.select().from(appSettings);
			const firstTs = first[0].updatedAt;
			// Tiny delay so the ISO timestamp can advance.
			await new Promise((r) => setTimeout(r, 5));
			await saveSetting(db, 'default_model', 'b');
			const second = await db.select().from(appSettings);
			expect(second[0].updatedAt).not.toBe(firstTs);
		});
	});
});
