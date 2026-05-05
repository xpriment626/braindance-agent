import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { fail, redirect, isRedirect } from '@sveltejs/kit';
import { getCurrentProject } from '$lib/core/projects/current';
import { listTopics } from '$lib/core/knowledge/topics';
import {
	countSourcesByProject,
	countSourcesByTopic,
	countPendingDiscoveryReportsByProject,
	countPendingDiscoveryReportsByTopic
} from '$lib/core/knowledge/aggregations';
import { resolveConfigDir, resolveDataDir, getPlatformInfo } from '$lib/core/paths';
import { loadConfig } from '$lib/core/config/load';
import { resolveConfig } from '$lib/core/config/resolve';
import { buildRuntime } from '$lib/core/runtime';
import { addKnowledge } from '$lib/core/workflows/addKnowledge';
import { ValidationError } from '$lib/core/errors/types';
import { normalizeError } from '$lib/core/errors/normalize';
import {
	openRegistry,
	createProject,
	deleteProject
} from '$lib/core/projects/project';
import {
	listRegistryEntries,
	getRegistryEntry
} from '$lib/core/projects/registry';
import { loadSettings } from '$lib/core/settings/load';
import { settingsToConfigLayer } from '$lib/core/settings/config-layer';
import { getTopic, deleteTopicCascade } from '$lib/core/knowledge/topics';
import { join, dirname } from 'node:path';
import { rm } from 'node:fs/promises';

const PROJECT_COOKIE = 'braindance_project_id';

const COOKIE_OPTS = {
	path: '/',
	httpOnly: true,
	sameSite: 'lax' as const,
	secure: false
};

const MAX_NAME = 64;

export const load: PageServerLoad = async ({ cookies }) => {
	const { handle } = await getCurrentProject(cookies);

	if (!handle) {
		return {
			project: null,
			stats: null,
			topics: [],
			openrouterKeyAvailable: false
		};
	}

	const dataDir = resolveDataDir(getPlatformInfo());
	const registry = await openRegistry(dataDir);
	const settings = await loadSettings(registry);
	const openrouterKeyAvailable =
		!!settings.openrouter_api_key || !!process.env.OPENROUTER_API_KEY;

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
		topics,
		openrouterKeyAvailable
	};
};

export const actions: Actions = {
	runAddKnowledge: async ({ request, cookies }: RequestEvent) => {
		const formData = await request.formData();
		const topicId = String(formData.get('topicId') ?? '').trim();
		if (!topicId) {
			return fail(400, { error: { code: 'VALIDATION_TOPIC_NOT_FOUND', message: 'topicId required' } });
		}

		const { handle } = await getCurrentProject(cookies);
		if (!handle) {
			return fail(400, {
				error: {
					code: 'VALIDATION_RUN_STATE',
					message: 'no project — run is not configurable'
				}
			});
		}

		try {
			const dataDir = resolveDataDir(getPlatformInfo());
			const registry = await openRegistry(dataDir);
			const settings = await loadSettings(registry);
			const userConfig = await loadConfig(resolveConfigDir(getPlatformInfo()));
			const resolved = resolveConfig({
				user: userConfig,
				settings: settingsToConfigLayer(settings)
			});
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
	},

	createProject: async ({ request, cookies }: RequestEvent) => {
		const formData = await request.formData();
		const rawName = String(formData.get('name') ?? '');
		const name = rawName.trim();

		if (!name) {
			return fail(400, {
				error: { code: 'VALIDATION_PROJECT_NAME_EMPTY', message: 'Project name is required.' },
				formData: { name: rawName }
			});
		}
		if (name.length > MAX_NAME) {
			return fail(400, {
				error: {
					code: 'VALIDATION_PROJECT_NAME_TOO_LONG',
					message: `Project name must be ${MAX_NAME} characters or fewer.`
				},
				formData: { name: rawName }
			});
		}

		try {
			const dataDir = resolveDataDir(getPlatformInfo());
			const registry = await openRegistry(dataDir);
			const handle = await createProject(dataDir, registry, name);
			cookies.set(PROJECT_COOKIE, handle.id, COOKIE_OPTS);
		} catch (e) {
			if (isRedirect(e)) throw e;
			const normalized = normalizeError(e);
			return fail(500, {
				error: { code: normalized.code, message: normalized.message },
				formData: { name: rawName }
			});
		}
		throw redirect(303, '/');
	},

	switchProject: async ({ request, cookies }: RequestEvent) => {
		const formData = await request.formData();
		const id = String(formData.get('id') ?? '').trim();
		if (!id) {
			return fail(400, {
				error: { code: 'VALIDATION_PROJECT_ID_EMPTY', message: 'Project id is required.' }
			});
		}

		const dataDir = resolveDataDir(getPlatformInfo());
		const registry = await openRegistry(dataDir);
		const entries = await listRegistryEntries(registry);
		if (!entries.some((e) => e.id === id)) {
			return fail(404, {
				error: { code: 'VALIDATION_PROJECT_NOT_FOUND', message: 'Project not found.' }
			});
		}

		cookies.set(PROJECT_COOKIE, id, COOKIE_OPTS);
		throw redirect(303, '/');
	},

	deleteTopic: async ({ request, cookies }: RequestEvent) => {
		const formData = await request.formData();
		const topicId = String(formData.get('id') ?? '').trim();
		const confirmName = String(formData.get('confirmName') ?? '');

		if (!topicId) {
			return fail(400, {
				error: { code: 'VALIDATION_TOPIC_ID_EMPTY', message: 'Topic id is required.' }
			});
		}

		const { handle } = await getCurrentProject(cookies);
		if (!handle) {
			return fail(400, {
				error: { code: 'VALIDATION_RUN_STATE', message: 'No project — nothing to delete.' }
			});
		}

		const topic = await getTopic(handle.db, topicId);
		if (!topic) {
			return fail(404, {
				error: { code: 'VALIDATION_TOPIC_NOT_FOUND', message: 'Topic not found.' }
			});
		}

		if (confirmName !== topic.name) {
			return fail(400, {
				error: {
					code: 'VALIDATION_TOPIC_DELETE_CONFIRM',
					message: 'Typed name does not match.'
				}
			});
		}

		try {
			const { removedSourcePaths } = await deleteTopicCascade(handle.db, topicId);
			const filesDir = join(handle.path, 'files');
			for (const rawPath of removedSourcePaths) {
				const sourceDir = join(filesDir, dirname(rawPath));
				try {
					await rm(sourceDir, { recursive: true, force: true });
				} catch (err) {
					console.warn('Failed to cleanup source dir', sourceDir, err);
				}
			}
		} catch (e) {
			if (isRedirect(e)) throw e;
			const normalized = normalizeError(e);
			return fail(500, {
				error: { code: normalized.code, message: normalized.message }
			});
		}
		throw redirect(303, '/');
	},

	deleteProject: async ({ request, cookies }: RequestEvent) => {
		const formData = await request.formData();
		const id = String(formData.get('id') ?? '').trim();
		const confirmName = String(formData.get('confirmName') ?? '');

		if (!id) {
			return fail(400, {
				error: { code: 'VALIDATION_PROJECT_ID_EMPTY', message: 'Project id is required.' }
			});
		}

		const dataDir = resolveDataDir(getPlatformInfo());
		const registry = await openRegistry(dataDir);
		const entry = await getRegistryEntry(registry, id);
		if (!entry) {
			return fail(404, {
				error: { code: 'VALIDATION_PROJECT_NOT_FOUND', message: 'Project not found.' }
			});
		}

		if (confirmName !== entry.name) {
			return fail(400, {
				error: {
					code: 'VALIDATION_PROJECT_DELETE_CONFIRM',
					message: 'Typed name does not match.'
				}
			});
		}

		try {
			await deleteProject(dataDir, registry, id);
			if (cookies.get(PROJECT_COOKIE) === id) {
				cookies.delete(PROJECT_COOKIE, { path: '/' });
			}
		} catch (e) {
			if (isRedirect(e)) throw e;
			const normalized = normalizeError(e);
			return fail(500, {
				error: { code: normalized.code, message: normalized.message }
			});
		}
		throw redirect(303, '/');
	}
};
