import type { LayoutServerLoad } from './$types';
import { getCurrentProject } from '$lib/core/projects/current';
import { listTopics } from '$lib/core/knowledge/topics';

// Approach B (per Spec 1): server-side load reads core lib directly. No
// internal API routes. Mutations live in `+page.server.ts` actions on the
// pages that own them.

export const load: LayoutServerLoad = async () => {
	const { handle, availableProjects } = await getCurrentProject();

	if (!handle) {
		return {
			project: null,
			availableProjects,
			topics: []
		};
	}

	const topics = await listTopics(handle.db);
	return {
		project: { id: handle.id, name: handle.name },
		availableProjects,
		topics: topics.map((t) => ({ id: t.id, name: t.name }))
	};
};
