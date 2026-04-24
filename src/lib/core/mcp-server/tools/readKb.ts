import type { Database } from '../../db/connection';
import { openProject } from '../../projects/project';
import { listSourcesByTopic, type Source } from '../../knowledge/sources';
import { sources as sourcesTable } from '../../db/schema';

export type ContentMode = 'full' | 'summary' | 'none';

export interface ReadKbContext {
	dataDir: string;
	registryDb: Database;
	projectId: string;
	topicId?: string;
	limit?: number;
	contentMode?: ContentMode;
}

export interface ReadKbEntry {
	id: string;
	title: string;
	type: string;
	provenance: string | null;
	created_at: string;
	metadata: Record<string, unknown> | null;
	content?: string;
}

const SUMMARY_CHARS = 300;

export async function readKbHandler(ctx: ReadKbContext): Promise<ReadKbEntry[]> {
	const project = await openProject(ctx.dataDir, ctx.registryDb, ctx.projectId);
	if (!project) throw new Error(`project not found: ${ctx.projectId}`);

	const rows = ctx.topicId
		? await listSourcesByTopic(project.db, ctx.topicId)
		: ((await project.db.select().from(sourcesTable)) as Source[]);

	const limited =
		ctx.limit !== undefined && ctx.limit >= 0 ? rows.slice(0, ctx.limit) : rows;
	const mode: ContentMode = ctx.contentMode ?? 'full';

	return limited.map((s) => toEntry(s, mode));
}

function toEntry(s: Source, mode: ContentMode): ReadKbEntry {
	const base: ReadKbEntry = {
		id: s.id,
		title: s.title,
		type: s.type,
		provenance: s.provenance,
		created_at: s.createdAt,
		metadata: s.metadata ? (JSON.parse(s.metadata) as Record<string, unknown>) : null
	};
	if (mode === 'none') return base;
	const content = s.content ?? '';
	base.content = mode === 'summary' ? content.slice(0, SUMMARY_CHARS) : content;
	return base;
}
