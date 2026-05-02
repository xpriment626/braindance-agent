import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { getCurrentProject } from '$lib/core/projects/current';
import { listTopics } from '$lib/core/knowledge/topics';
import {
	countSourcesByProject,
	countSourcesByTopic,
	countPendingDiscoveryReportsByProject,
	countPendingDiscoveryReportsByTopic
} from '$lib/core/knowledge/aggregations';
import { resolveConfigDir, getPlatformInfo } from '$lib/core/paths';
import { loadConfig } from '$lib/core/config/load';
import { resolveConfig } from '$lib/core/config/resolve';
import { buildRuntime } from '$lib/core/runtime';
import { addKnowledge } from '$lib/core/workflows/addKnowledge';
import { ValidationError } from '$lib/core/errors/types';
import { normalizeError } from '$lib/core/errors/normalize';

export const load: PageServerLoad = async () => {
	const { handle } = await getCurrentProject();

	if (!handle) {
		return {
			project: null,
			stats: null,
			topics: []
		};
	}

	const [topicsRows, totalSources, pendingReports] = await Promise.all([
		listTopics(handle.db),
		countSourcesByProject(handle.db),
		countPendingDiscoveryReportsByProject(handle.db)
	]);

	const topics = await Promise.all(
		topicsRows.map(async (t) => {
			const [sources, pending] = await Promise.all([
				countSourcesByTopic(handle.db, t.id),
				countPendingDiscoveryReportsByTopic(handle.db, t.id)
			]);
			return {
				id: t.id,
				name: t.name,
				narrativeThreads: t.narrativeThreads
					? (JSON.parse(t.narrativeThreads) as string[])
					: [],
				sourceCount: sources,
				pendingReportCount: pending
			};
		})
	);

	return {
		project: { id: handle.id, name: handle.name },
		stats: {
			topicCount: topicsRows.length,
			sourceCount: totalSources,
			pendingReports
		},
		topics
	};
};

export const actions: Actions = {
	runAddKnowledge: async ({ request }) => {
		const formData = await request.formData();
		const topicId = String(formData.get('topicId') ?? '').trim();
		if (!topicId) {
			return fail(400, { error: { code: 'VALIDATION_TOPIC_NOT_FOUND', message: 'topicId required' } });
		}

		const { handle } = await getCurrentProject();
		if (!handle) {
			return fail(400, {
				error: {
					code: 'VALIDATION_RUN_STATE',
					message: 'no project — run is not configurable'
				}
			});
		}

		try {
			const userConfig = await loadConfig(resolveConfigDir(getPlatformInfo()));
			const resolved = resolveConfig({ user: userConfig });
			const runtime = await buildRuntime(resolved);
			try {
				const result = await addKnowledge(handle.db, topicId, {
					llm: runtime.llm,
					channels: runtime.channels,
					config: {}
				});
				return { ok: true, workflowRunId: result.workflowRunId };
			} finally {
				await runtime.cleanup();
			}
		} catch (e) {
			const normalized = normalizeError(e);
			if (e instanceof ValidationError) {
				return fail(400, { error: { code: normalized.code, message: normalized.message } });
			}
			return fail(500, { error: { code: normalized.code, message: normalized.message } });
		}
	}
};
