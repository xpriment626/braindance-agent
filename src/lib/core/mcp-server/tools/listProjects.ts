import type { Database } from '../../db/connection';
import { listRegistryEntries } from '../../projects/registry';

export interface ListProjectsContext {
	registryDb: Database;
}

export interface ListProjectsEntry {
	id: string;
	name: string;
	created_at: string;
}

export async function listProjectsHandler(
	ctx: ListProjectsContext
): Promise<ListProjectsEntry[]> {
	const entries = await listRegistryEntries(ctx.registryDb);
	return entries.map((e) => ({
		id: e.id,
		name: e.name,
		created_at: e.createdAt
	}));
}
