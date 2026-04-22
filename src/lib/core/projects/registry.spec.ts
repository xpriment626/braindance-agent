import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../db/connection';
import { initRegistryDb } from '../db/registry-schema';
import {
	createRegistryEntry,
	listRegistryEntries,
	getRegistryEntry,
	updateRegistryEntry,
	deleteRegistryEntry
} from './registry';

describe('project registry', () => {
	let db: ReturnType<typeof createDb>;

	beforeEach(async () => {
		db = createDb(':memory:');
		await initRegistryDb(db);
	});

	describe('createRegistryEntry', () => {
		it('creates an entry and returns it with generated id', async () => {
			const entry = await createRegistryEntry(db, 'My Project', 'projects/abc123');
			expect(entry.id).toHaveLength(26);
			expect(entry.name).toBe('My Project');
			expect(entry.path).toBe('projects/abc123');
			expect(entry.createdAt).toBeTruthy();
			expect(entry.updatedAt).toBeTruthy();
		});

		it('defaults config to null', async () => {
			const entry = await createRegistryEntry(db, 'Test', 'projects/x');
			expect(entry.config).toBeNull();
			const found = await getRegistryEntry(db, entry.id);
			expect(found!.config).toBeNull();
		});
	});

	describe('listRegistryEntries', () => {
		it('returns all entries', async () => {
			await createRegistryEntry(db, 'Project A', 'projects/a');
			await createRegistryEntry(db, 'Project B', 'projects/b');
			const entries = await listRegistryEntries(db);
			expect(entries).toHaveLength(2);
		});

		it('returns empty array when no entries', async () => {
			const entries = await listRegistryEntries(db);
			expect(entries).toEqual([]);
		});
	});

	describe('getRegistryEntry', () => {
		it('returns entry by id', async () => {
			const created = await createRegistryEntry(db, 'Test', 'projects/x');
			const found = await getRegistryEntry(db, created.id);
			expect(found).not.toBeNull();
			expect(found!.name).toBe('Test');
		});

		it('returns null for unknown id', async () => {
			const found = await getRegistryEntry(db, 'nonexistent');
			expect(found).toBeNull();
		});
	});

	describe('updateRegistryEntry', () => {
		it('updates the name', async () => {
			const created = await createRegistryEntry(db, 'Old Name', 'projects/x');
			await updateRegistryEntry(db, created.id, { name: 'New Name' });
			const found = await getRegistryEntry(db, created.id);
			expect(found!.name).toBe('New Name');
		});

		it('updates the updatedAt timestamp', async () => {
			const created = await createRegistryEntry(db, 'Test', 'projects/x');
			const originalUpdatedAt = created.updatedAt;
			// Small delay to ensure timestamp difference
			await new Promise((r) => setTimeout(r, 10));
			await updateRegistryEntry(db, created.id, { name: 'Updated' });
			const found = await getRegistryEntry(db, created.id);
			expect(found!.updatedAt).not.toBe(originalUpdatedAt);
		});

		it('writes config as a JSON string', async () => {
			const created = await createRegistryEntry(db, 'Test', 'projects/x');
			const overrides = { capabilities: { writer: { model: 'haiku' } } };
			await updateRegistryEntry(db, created.id, { config: JSON.stringify(overrides) });
			const found = await getRegistryEntry(db, created.id);
			expect(found!.config).toBe(JSON.stringify(overrides));
			expect(JSON.parse(found!.config!)).toEqual(overrides);
		});

		it('clears config back to null', async () => {
			const created = await createRegistryEntry(db, 'Test', 'projects/x');
			await updateRegistryEntry(db, created.id, { config: '{}' });
			await updateRegistryEntry(db, created.id, { config: null });
			const found = await getRegistryEntry(db, created.id);
			expect(found!.config).toBeNull();
		});
	});

	describe('deleteRegistryEntry', () => {
		it('removes the entry', async () => {
			const created = await createRegistryEntry(db, 'Doomed', 'projects/x');
			await deleteRegistryEntry(db, created.id);
			const found = await getRegistryEntry(db, created.id);
			expect(found).toBeNull();
		});
	});
});
