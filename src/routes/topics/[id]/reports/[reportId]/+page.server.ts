import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { fail, error } from '@sveltejs/kit';
import { getCurrentProject } from '$lib/core/projects/current';
import { getTopic } from '$lib/core/knowledge/topics';
import {
	getDiscoveryReport,
	dismissDiscoveryReport
} from '$lib/core/knowledge/discovery-reports';
import { getSeedByDiscoveryReport } from '$lib/core/knowledge/seeds';
import {
	listSignalsByReport,
	approveSignal,
	dismissSignal
} from '$lib/core/knowledge/signals';
import { getSource } from '$lib/core/knowledge/sources';
import {
	openDiscoveryReportForReview,
	acceptDiscoveredSource,
	declineDiscoveredSource
} from '$lib/core/workflows/promoteDiscoveredSource';
import { pruneCorpus } from '$lib/core/workflows/pruneCorpus';
import { resolveConfigDir, resolveDataDir, getPlatformInfo } from '$lib/core/paths';
import { loadConfig } from '$lib/core/config/load';
import { resolveConfig } from '$lib/core/config/resolve';
import { buildRuntime } from '$lib/core/runtime';
import { openRegistry } from '$lib/core/projects/project';
import { loadSettings } from '$lib/core/settings/load';
import { settingsToConfigLayer } from '$lib/core/settings/config-layer';
import { ValidationError } from '$lib/core/errors/types';
import { normalizeError } from '$lib/core/errors/normalize';

export const load: PageServerLoad = async ({ params, cookies }) => {
	const { handle } = await getCurrentProject(cookies);
	if (!handle) throw error(404, 'No active project');

	const topic = await getTopic(handle.db, params.id);
	if (!topic) throw error(404, `Topic "${params.id}" not found`);

	const report = await getDiscoveryReport(handle.db, params.reportId);
	if (!report) throw error(404, `Report "${params.reportId}" not found`);
	if (report.topicId !== topic.id) {
		throw error(404, `Report does not belong to this topic`);
	}

	// Eager seed creation when the user opens a pending report (decision 17 +
	// Spec 1 §2 B1). Idempotent — returns the existing seed if already created.
	// Gated on `pending` status because openDiscoveryReportForReview throws on
	// non-pending reports; viewing a reviewed/dismissed report should not retry
	// seed creation. Also gated on non-empty proposals (open-for-review has its
	// own throw on zero proposals — auto-dismiss should have caught these
	// already, but be defensive in case of pre-Phase-B-3 stranded reports).
	if (report.status === 'pending' && report.newSources.length > 0) {
		try {
			await openDiscoveryReportForReview(handle.db, report.id);
		} catch (e) {
			// If the seed primitive can't open, leave the page renderable with
			// an inline error — don't 500 the route. The user can navigate away
			// and try again.
			console.warn('openDiscoveryReportForReview failed at page-load', e);
		}
	}

	const seed = await getSeedByDiscoveryReport(handle.db, report.id);
	const allSignals = await listSignalsByReport(handle.db, report.id);

	// Enrich signals with target-source titles so the panel can render
	// "Bainbridge 1983" instead of an opaque ULID. Thread-targeted signals
	// surface their thread name from metadata.
	const enrichedSignals = await Promise.all(
		allSignals.map(async (s) => {
			let targetLabel: string | null = null;
			if (s.targetType === 'source') {
				const src = await getSource(handle.db, s.targetId);
				targetLabel = src?.title ?? '(source removed)';
			} else if (s.targetType === 'thread') {
				const thread = (s.metadata?.thread as string | undefined) ?? null;
				targetLabel = thread ?? topic.name;
			}
			return {
				id: s.id,
				signalType: s.signalType,
				targetType: s.targetType,
				targetLabel,
				reason: s.reason,
				status: s.status,
				metadata: s.metadata,
				createdAt: s.createdAt
			};
		})
	);

	const sourcesAccepted = report.newSources.filter((p) => p.status === 'accepted').length;
	const sourcesDeclined = report.newSources.filter((p) => p.status === 'declined').length;
	const sourcesPending = report.newSources.filter((p) => p.status === 'pending').length;
	const signalsPending = enrichedSignals.filter((s) => s.status === 'pending').length;
	const signalsApproved = enrichedSignals.filter((s) => s.status === 'approved').length;
	const signalsDismissed = enrichedSignals.filter((s) => s.status === 'dismissed').length;
	const signalsApplied = enrichedSignals.filter((s) => s.status === 'applied').length;

	return {
		topic: { id: topic.id, name: topic.name },
		report: {
			id: report.id,
			status: report.status,
			summary: report.summary,
			createdAt: report.createdAt,
			reviewedAt: report.reviewedAt,
			newSources: report.newSources.map((p, i) => ({ ...p, index: i }))
		},
		seed: seed ? { id: seed.id, inputCount: seed.inputCount, processedCount: seed.processedCount } : null,
		signals: enrichedSignals,
		counts: {
			sourcesAccepted,
			sourcesDeclined,
			sourcesPending,
			signalsPending,
			signalsApproved,
			signalsDismissed,
			signalsApplied
		}
	};
};

function parseIndex(formData: FormData): number | null {
	const raw = formData.get('index');
	if (raw === null) return null;
	const n = Number(String(raw));
	return Number.isInteger(n) && n >= 0 ? n : null;
}

function parseId(formData: FormData, key: string): string | null {
	const raw = formData.get(key);
	if (raw === null) return null;
	const s = String(raw).trim();
	return s.length > 0 ? s : null;
}

function failFrom(e: unknown) {
	const n = normalizeError(e);
	const status = e instanceof ValidationError ? 400 : 500;
	return fail(status, { error: { code: n.code, message: n.message } });
}

export const actions: Actions = {
	acceptSource: async ({ request, cookies, params }: RequestEvent) => {
		const formData = await request.formData();
		const idx = parseIndex(formData);
		if (idx === null) {
			return fail(400, { error: { code: 'VALIDATION_RUN_STATE', message: 'invalid index' } });
		}
		const { handle } = await getCurrentProject(cookies);
		if (!handle) {
			return fail(400, { error: { code: 'VALIDATION_RUN_STATE', message: 'no active project' } });
		}
		try {
			await acceptDiscoveredSource(handle.db, String(params.reportId ?? ''), idx);
			return { ok: true };
		} catch (e) {
			return failFrom(e);
		}
	},

	declineSource: async ({ request, cookies, params }: RequestEvent) => {
		const formData = await request.formData();
		const idx = parseIndex(formData);
		if (idx === null) {
			return fail(400, { error: { code: 'VALIDATION_RUN_STATE', message: 'invalid index' } });
		}
		const { handle } = await getCurrentProject(cookies);
		if (!handle) {
			return fail(400, { error: { code: 'VALIDATION_RUN_STATE', message: 'no active project' } });
		}
		try {
			await declineDiscoveredSource(handle.db, String(params.reportId ?? ''), idx);
			return { ok: true };
		} catch (e) {
			return failFrom(e);
		}
	},

	approveSignal: async ({ request, cookies }: RequestEvent) => {
		const formData = await request.formData();
		const signalId = parseId(formData, 'signalId');
		if (!signalId) {
			return fail(400, { error: { code: 'VALIDATION_RUN_STATE', message: 'invalid signalId' } });
		}
		const { handle } = await getCurrentProject(cookies);
		if (!handle) {
			return fail(400, { error: { code: 'VALIDATION_RUN_STATE', message: 'no active project' } });
		}
		try {
			await approveSignal(handle.db, signalId);
			return { ok: true };
		} catch (e) {
			return failFrom(e);
		}
	},

	dismissSignal: async ({ request, cookies }: RequestEvent) => {
		const formData = await request.formData();
		const signalId = parseId(formData, 'signalId');
		if (!signalId) {
			return fail(400, { error: { code: 'VALIDATION_RUN_STATE', message: 'invalid signalId' } });
		}
		const reason = parseId(formData, 'reason') ?? 'user dismissed during review';
		const { handle } = await getCurrentProject(cookies);
		if (!handle) {
			return fail(400, { error: { code: 'VALIDATION_RUN_STATE', message: 'no active project' } });
		}
		try {
			await dismissSignal(handle.db, signalId, reason);
			return { ok: true };
		} catch (e) {
			return failFrom(e);
		}
	},

	dismissReport: async ({ cookies, params }: RequestEvent) => {
		const { handle } = await getCurrentProject(cookies);
		if (!handle) {
			return fail(400, { error: { code: 'VALIDATION_RUN_STATE', message: 'no active project' } });
		}
		try {
			await dismissDiscoveryReport(handle.db, String(params.reportId ?? ''));
			return { ok: true };
		} catch (e) {
			return failFrom(e);
		}
	},

	applyApprovedSignals: async ({ cookies, params }: RequestEvent) => {
		const { handle } = await getCurrentProject(cookies);
		if (!handle) {
			return fail(400, { error: { code: 'VALIDATION_RUN_STATE', message: 'no active project' } });
		}
		const topicId = String(params.id ?? '');
		const reportId = String(params.reportId ?? '');

		// Authoritative server-side fetch — don't trust client list. Bounded
		// by the FK so prune only touches signals from this report (per Phase
		// B canvas spec; KB-wide prune is the dedicated Maintenance surface).
		const approved = await listSignalsByReport(handle.db, reportId, 'approved');
		if (approved.length === 0) {
			return fail(400, {
				error: {
					code: 'VALIDATION_RUN_STATE',
					message: 'no approved signals to apply'
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
				const result = await pruneCorpus(
					handle.db,
					topicId,
					approved.map((s) => s.id),
					{ llm: runtime.llm, config: {} }
				);
				return {
					ok: true as const,
					prune: {
						summary: result.log.summary,
						appliedMutations: result.log.appliedMutations,
						attemptedCount: approved.length
					}
				};
			} finally {
				await runtime.cleanup();
			}
		} catch (e) {
			return failFrom(e);
		}
	}
};
