import type { Database } from '../../db/connection';
import { openProject } from '../../projects/project';
import { listTopics } from '../../knowledge/topics';

export interface ListTopicsContext {
	dataDir: string;
	registryDb: Database;
	projectId: string;
}

export interface ListTopicsEntry {
	id: string;
	name: string;
	description: string | null;
	narrative_threads: string[];
}

export async function listTopicsHandler(
	ctx: ListTopicsContext
): Promise<ListTopicsEntry[]> {
	const project = await openProject(ctx.dataDir, ctx.registryDb, ctx.projectId);
	if (!project) throw new Error(`project not found: ${ctx.projectId}`);

	const rows = await listTopics(project.db);
	return rows.map((t) => ({
		id: t.id,
		name: t.name,
		description: t.description,
		narrative_threads: t.narrativeThreads ? (JSON.parse(t.narrativeThreads) as string[]) : []
	}));
}
