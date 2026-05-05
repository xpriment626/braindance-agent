import type { LayoutServerLoad } from './$types';
import { getCurrentProject } from '$lib/core/projects/current';
import { listTopics } from '$lib/core/knowledge/topics';

// Approach B (per Spec 1): server-side load reads core lib directly. No
// internal API routes. Mutations live in `+page.server.ts` actions on the
// pages that own them.

interface AvailableProject {
	id: string;
	name: string;
	displayName: string;
}

function withDisambiguation(
	entries: Array<{ id: string; name: string }>
): AvailableProject[] {
	const counts = new Map<string, number>();
	for (const e of entries) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
	return entries.map((e) => ({
		...e,
		displayName:
			(counts.get(e.name) ?? 0) > 1 ? `${e.name} · ${e.id.slice(-4)}` : e.name
	}));
}

export const load: LayoutServerLoad = async ({ cookies }) => {
	const { handle, availableProjects } = await getCurrentProject(cookies);
	const projects = withDisambiguation(availableProjects);

	if (!handle) {
		return {
			project: null,
			availableProjects: projects,
			topics: []
		};
	}

	const topics = await listTopics(handle.db);
	const current = projects.find((p) => p.id === handle.id);
	return {
		project: {
			id: handle.id,
			name: handle.name,
			displayName: current?.displayName ?? handle.name
		},
		availableProjects: projects,
		topics: topics.map((t) => ({ id: t.id, name: t.name }))
	};
};
