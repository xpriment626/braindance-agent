import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { fail, redirect, isRedirect } from '@sveltejs/kit';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { getCurrentProject } from '$lib/core/projects/current';
import { processBriefingCard } from '$lib/core/knowledge/process';
import { materializeUpload, validateUpload } from '$lib/core/knowledge/handlers/file-validation';
import { ValidationError } from '$lib/core/errors/types';
import { normalizeError } from '$lib/core/errors/normalize';
import type { SeedInput } from '$lib/core/knowledge/handlers/types';

const MAX_TOPIC_NAME = 120;

export const load: PageServerLoad = async ({ cookies }) => {
	const { handle } = await getCurrentProject(cookies);
	if (!handle) {
		throw redirect(303, '/');
	}
	return {
		project: { id: handle.id, name: handle.name }
	};
};

export const actions: Actions = {
	createTopicViaBriefingCard: async ({ request, cookies }: RequestEvent) => {
		const formData = await request.formData();

		const rawName = String(formData.get('name') ?? '');
		const name = rawName.trim();
		const description = String(formData.get('description') ?? '').trim() || undefined;
		const guidance = String(formData.get('guidance') ?? '').trim() || undefined;
		const threadsRaw = String(formData.get('narrative_threads') ?? '');
		const narrativeThreads = threadsRaw
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);

		const formEcho = {
			name: rawName,
			description: String(formData.get('description') ?? ''),
			guidance: String(formData.get('guidance') ?? ''),
			narrative_threads: threadsRaw
		};

		if (!name) {
			return fail(400, {
				error: { code: 'VALIDATION_TOPIC_NAME_EMPTY', message: 'Topic name is required.' },
				formData: formEcho
			});
		}
		if (name.length > MAX_TOPIC_NAME) {
			return fail(400, {
				error: {
					code: 'VALIDATION_TOPIC_NAME_TOO_LONG',
					message: `Topic name must be ${MAX_TOPIC_NAME} characters or fewer.`
				},
				formData: formEcho
			});
		}

		const { handle } = await getCurrentProject(cookies);
		if (!handle) {
			return fail(400, {
				error: { code: 'VALIDATION_RUN_STATE', message: 'No project — create one first.' },
				formData: formEcho
			});
		}

		// Build inputs from indexed form fields. Pre-validate file sizes / types
		// before materializing anything to disk so a single bad file rejects the
		// whole submission cleanly without leaving temp files behind.
		const inputCount = Number(formData.get('input_count') ?? 0);
		const inputs: SeedInput[] = [];
		const tempFilesToCleanup: string[] = [];

		try {
			for (let i = 0; i < inputCount; i++) {
				const type = String(formData.get(`input_type_${i}`) ?? '');
				if (type === 'text') {
					const value = String(formData.get(`input_text_${i}`) ?? '').trim();
					if (value) inputs.push({ type: 'text', value });
				} else if (type === 'url') {
					const value = String(formData.get(`input_url_${i}`) ?? '').trim();
					if (value) inputs.push({ type: 'url', value });
				} else if (type === 'file') {
					const file = formData.get(`input_file_${i}`);
					if (!(file instanceof File) || file.size === 0) continue;
					const validation = validateUpload(file);
					if (!validation.ok) {
						return fail(400, {
							error: {
								code:
									validation.kind === 'file-too-large'
										? 'VALIDATION_FILE_TOO_LARGE'
										: 'VALIDATION_FILE_TYPE_REJECTED',
								message: validation.message
							},
							formData: formEcho
						});
					}
					const tempPath = await materializeUpload(file, handle.path);
					tempFilesToCleanup.push(tempPath);
					inputs.push({ type: 'file', value: tempPath });
				}
			}

			await processBriefingCard(
				handle.db,
				null,
				{
					name,
					description,
					guidance,
					narrativeThreads: narrativeThreads.length > 0 ? narrativeThreads : undefined,
					inputs
				},
				{ filesDir: join(handle.path, 'files'), origin: 'user' }
			);
		} catch (e) {
			if (isRedirect(e)) throw e;
			const normalized = normalizeError(e);
			const status = e instanceof ValidationError ? 400 : 500;
			return fail(status, {
				error: { code: normalized.code, message: normalized.message },
				formData: formEcho
			});
		} finally {
			for (const path of tempFilesToCleanup) {
				try {
					await unlink(path);
				} catch (err) {
					console.warn('Failed to cleanup temp upload', path, err);
				}
			}
		}

		throw redirect(303, '/');
	}
};
