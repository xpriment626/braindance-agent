<script lang="ts">
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type InputRow =
		| { id: string; type: 'text'; value: string }
		| { id: string; type: 'url'; value: string }
		| { id: string; type: 'file'; file: File | null };

	let inputs = $state<InputRow[]>([]);

	let nextId = 0;
	function newId(): string {
		nextId += 1;
		return `row-${nextId}`;
	}

	function addText() {
		inputs.push({ id: newId(), type: 'text', value: '' });
	}
	function addUrl() {
		inputs.push({ id: newId(), type: 'url', value: '' });
	}
	function addFile() {
		inputs.push({ id: newId(), type: 'file', file: null });
	}
	function removeAt(idx: number) {
		inputs.splice(idx, 1);
	}

	function onFilePick(idx: number, e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		const file = target.files?.[0] ?? null;
		const row = inputs[idx];
		if (row.type === 'file') {
			row.file = file;
		}
	}

	const echo = $derived(form && 'formData' in form ? form.formData : null);
</script>

<section class="flex flex-col gap-6 px-9 pb-8 pt-7">
	<header class="flex flex-col gap-2.5">
		<a
			href="/"
			class="text-[11px] font-medium uppercase tracking-wider text-text-muted hover:text-dusk"
		>
			‹ {data.project.name}
		</a>
		<h1 class="text-[28px] font-semibold leading-tight tracking-tight text-midnight">
			New topic
		</h1>
	</header>

	{#if form?.error}
		<div
			class="rounded-lg border border-red-thread/30 bg-red-thread/5 px-4 py-3 text-sm text-red-thread"
		>
			<div class="font-mono text-[11px] font-semibold uppercase tracking-wider">
				{form.error.code}
			</div>
			<div class="mt-1 text-midnight">{form.error.message}</div>
		</div>
	{/if}

	<form
		method="POST"
		action="?/createTopicViaBriefingCard"
		enctype="multipart/form-data"
		class="flex flex-col gap-6"
	>
		<input type="hidden" name="input_count" value={inputs.length} />

		<div class="grid grid-cols-[1fr_1fr] gap-5">
			<!-- TOPIC METADATA -->
			<div class="flex flex-col gap-4 rounded-xl border border-border bg-card-bg p-6">
				<h2
					class="text-[11px] font-medium uppercase tracking-wider text-text-muted"
				>
					Topic metadata
				</h2>

				<label class="flex flex-col gap-1.5">
					<span class="text-[11px] font-medium uppercase tracking-wider text-text-muted">
						Name
					</span>
					<input
						type="text"
						name="name"
						required
						maxlength="120"
						autocomplete="off"
						value={echo?.name ?? ''}
						placeholder="HCI at the agent paradigm inflection"
						class="rounded-lg border border-border bg-page-bg px-3 py-2 text-sm text-midnight outline-none focus:border-dusk"
					/>
				</label>

				<label class="flex flex-col gap-1.5">
					<span class="text-[11px] font-medium uppercase tracking-wider text-text-muted">
						Description
					</span>
					<textarea
						name="description"
						rows="3"
						placeholder="What this topic is about (one or two sentences)."
						class="rounded-lg border border-border bg-page-bg px-3 py-2 text-sm text-midnight outline-none focus:border-dusk"
						>{echo?.description ?? ''}</textarea
					>
				</label>

				<label class="flex flex-col gap-1.5">
					<span class="text-[11px] font-medium uppercase tracking-wider text-text-muted">
						Guidance
					</span>
					<textarea
						name="guidance"
						rows="4"
						placeholder="What sources to favor, what to skip, how skeptical to be."
						class="rounded-lg border border-border bg-page-bg px-3 py-2 text-sm text-midnight outline-none focus:border-dusk"
						>{echo?.guidance ?? ''}</textarea
					>
				</label>

				<label class="flex flex-col gap-1.5">
					<span class="text-[11px] font-medium uppercase tracking-wider text-text-muted">
						Narrative threads
					</span>
					<input
						type="text"
						name="narrative_threads"
						autocomplete="off"
						value={echo?.narrative_threads ?? ''}
						placeholder="comma, separated, threads"
						class="rounded-lg border border-border bg-page-bg px-3 py-2 text-sm text-midnight outline-none focus:border-dusk"
					/>
					<span class="text-[11px] text-text-muted">
						Optional. Sub-threads that the audit agent uses to track topic structure.
					</span>
				</label>
			</div>

			<!-- SOURCES QUEUE -->
			<div class="flex flex-col gap-4 rounded-xl border border-border bg-card-bg p-6">
				<div class="flex items-center justify-between">
					<h2
						class="text-[11px] font-medium uppercase tracking-wider text-text-muted"
					>
						Sources queue
					</h2>
					<div class="flex items-center gap-1.5">
						<button
							type="button"
							onclick={addText}
							class="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-dusk hover:bg-cloud"
						>
							+ Text
						</button>
						<button
							type="button"
							onclick={addUrl}
							class="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-dusk hover:bg-cloud"
						>
							+ URL
						</button>
						<button
							type="button"
							onclick={addFile}
							class="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-dusk hover:bg-cloud"
						>
							+ File
						</button>
					</div>
				</div>

				{#if inputs.length === 0}
					<p class="rounded-lg border border-dashed border-border px-4 py-6 text-center text-[12px] text-text-muted">
						No sources yet — add them above. You can also create the topic empty and add sources later.
					</p>
				{:else}
					<ul class="flex flex-col gap-2">
						{#each inputs as row, idx (row.id)}
							<li class="flex flex-col gap-2 rounded-lg border border-border bg-page-bg p-3">
								<div class="flex items-center justify-between">
									<span
										class="text-[10px] font-semibold uppercase tracking-wider text-text-muted"
									>
										{row.type}
									</span>
									<button
										type="button"
										onclick={() => removeAt(idx)}
										class="text-[12px] text-text-muted hover:text-red-thread"
										aria-label="Remove input"
									>
										✕
									</button>
								</div>

								<input
									type="hidden"
									name={`input_type_${idx}`}
									value={row.type}
								/>

								{#if row.type === 'text'}
									<textarea
										name={`input_text_${idx}`}
										rows="3"
										bind:value={row.value}
										placeholder="Paste a paragraph, quote, or note…"
										class="rounded-md border border-border bg-card-bg px-2 py-1.5 text-[13px] text-midnight outline-none focus:border-dusk"
									></textarea>
								{:else if row.type === 'url'}
									<input
										type="url"
										name={`input_url_${idx}`}
										bind:value={row.value}
										placeholder="https://…"
										autocomplete="off"
										class="rounded-md border border-border bg-card-bg px-2 py-1.5 text-[13px] text-midnight outline-none focus:border-dusk"
									/>
								{:else if row.type === 'file'}
									<input
										type="file"
										name={`input_file_${idx}`}
										accept=".txt,.md,.markdown,.json,text/plain,text/markdown,text/x-markdown,application/json"
										onchange={(e) => onFilePick(idx, e)}
										class="text-[12px] text-dusk file:mr-3 file:rounded-md file:border file:border-border file:bg-card-bg file:px-2 file:py-1 file:text-[11px] file:text-dusk hover:file:bg-cloud"
									/>
									<span class="text-[10px] text-text-muted">
										Text files only — .txt, .md, .markdown, .json (≤ 1 MB).
										{#if row.file}
											· {row.file.name}
											· {(row.file.size / 1024).toFixed(1)} KB
										{/if}
									</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>

		<div class="flex items-center justify-end gap-2.5">
			<a
				href="/"
				class="rounded-lg border border-border px-3.5 py-2 text-sm text-dusk hover:bg-cloud"
			>
				Cancel
			</a>
			<button
				type="submit"
				class="rounded-lg bg-midnight px-4 py-2 text-sm font-medium text-cloud hover:opacity-90"
			>
				Create topic
			</button>
		</div>
	</form>
</section>
