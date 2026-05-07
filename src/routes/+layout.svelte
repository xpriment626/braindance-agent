<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	const project = $derived(data.project);
	const topics = $derived(data.topics);
	const availableProjects = $derived(data.availableProjects);

	let deleteDialog: HTMLDialogElement | null = $state(null);
	let confirmInput: HTMLInputElement | null = $state(null);
	let confirmTyped = $state('');
	const confirmMatches = $derived(project ? confirmTyped === project.name : false);

	let createDetails: HTMLDetailsElement | null = $state(null);

	function openDelete() {
		confirmTyped = '';
		deleteDialog?.showModal();
		// Defer focus so the dialog is in the DOM tree.
		setTimeout(() => confirmInput?.focus(), 0);
	}

	function closeDelete() {
		deleteDialog?.close();
	}

	function closeCreate() {
		if (createDetails) createDetails.open = false;
	}

	function onPickerChange(e: Event) {
		const form = (e.currentTarget as HTMLSelectElement).form;
		form?.requestSubmit();
	}

	// Close the inline create-project reveal when the user clicks anywhere
	// outside it. Native <details> doesn't do this on its own; the contains()
	// check guards against the summary toggle firing immediately after.
	function onWindowClick(e: MouseEvent) {
		if (!createDetails || !createDetails.open) return;
		const target = e.target as Node;
		if (createDetails.contains(target)) return;
		createDetails.open = false;
	}
</script>

<svelte:window onclick={onWindowClick} />

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="grid min-h-screen grid-cols-[16rem_1fr]">
	<aside class="flex flex-col border-r border-border bg-sidebar-bg">
		<div class="px-5 py-6">
			<a href="/" class="block text-base font-semibold text-midnight">Braindance</a>
		</div>

		{#if project}
			<div class="px-5 py-3">
				<div class="text-[11px] font-medium uppercase tracking-wider text-text-muted">
					Project
				</div>
				<form method="POST" action="/?/switchProject" class="mt-1">
					<select
						name="id"
						value={project.id}
						onchange={onPickerChange}
						class="w-full appearance-none rounded-md bg-transparent px-2 py-1.5 pr-6 text-sm text-midnight hover:bg-cloud focus:outline-none"
					>
						{#each availableProjects as p (p.id)}
							<option value={p.id}>{p.displayName}</option>
						{/each}
					</select>
				</form>
			</div>

			<nav class="flex-1 px-5 py-3">
				<div
					class="flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-text-muted"
				>
					<span>Topics</span>
					<span>· {topics.length}</span>
				</div>
				<ul class="mt-1 space-y-0.5">
					{#each topics as topic (topic.id)}
						{@const href = `/topics/${topic.id}`}
						{@const active = page.url.pathname === href}
						<li>
							<a
								{href}
								class="block truncate rounded-md px-2 py-1.5 text-sm hover:bg-cloud"
								class:bg-cloud={active}
								class:text-midnight={active}
								class:text-dusk={!active}
							>
								{topic.name}
							</a>
						</li>
					{:else}
						<li class="px-2 py-1.5 text-xs text-text-muted">No topics yet.</li>
					{/each}
				</ul>
			</nav>

			<div class="border-t border-border px-5 py-3">
				<details bind:this={createDetails} class="group">
					<summary
						class="flex cursor-pointer list-none items-center gap-1.5 text-[12px] text-dusk hover:text-midnight"
					>
						<svg viewBox="0 0 12 12" class="h-3 w-3" aria-hidden="true">
							<path
								d="M6 2.5v7M2.5 6h7"
								stroke="currentColor"
								stroke-width="1.25"
								fill="none"
							/>
						</svg>
						New project
					</summary>
					<form
						method="POST"
						action="/?/createProject"
						class="mt-2 flex flex-col gap-1.5"
					>
						<div class="flex items-center gap-1.5">
							<input
								type="text"
								name="name"
								required
								maxlength="64"
								placeholder="Project name"
								class="flex-1 rounded-md border border-border bg-page-bg px-2 py-1.5 text-sm text-midnight outline-none focus:border-dusk"
							/>
							<button
								type="button"
								onclick={closeCreate}
								aria-label="Cancel"
								class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-cloud hover:text-midnight"
							>
								<svg viewBox="0 0 12 12" class="h-3 w-3" aria-hidden="true">
									<path
										d="M3 3l6 6M9 3l-6 6"
										stroke="currentColor"
										stroke-width="1.25"
										fill="none"
									/>
								</svg>
							</button>
						</div>
						<button
							type="submit"
							class="rounded-md bg-midnight px-2.5 py-1.5 text-[12px] font-medium text-cloud hover:opacity-90"
						>
							Create
						</button>
					</form>
				</details>

				<button
					type="button"
					onclick={openDelete}
					class="mt-2 flex items-center gap-1.5 text-[12px] text-text-muted hover:text-red-thread"
				>
					<svg viewBox="0 0 12 12" class="h-3 w-3" aria-hidden="true">
						<path
							d="M3 4h6M5 6v3M7 6v3M2.5 4l.5 6h6l.5-6"
							stroke="currentColor"
							stroke-width="1.1"
							fill="none"
						/>
					</svg>
					Delete current project
				</button>
			</div>

			<div class="border-t border-border px-5 py-3">
				<a
					href="/settings"
					class="flex items-center gap-2 text-sm text-dusk hover:text-midnight"
				>
					<div class="h-7 w-7 shrink-0 rounded-full bg-starlight" aria-hidden="true"></div>
					<div class="min-w-0 flex-1">
						<div class="truncate text-sm">You</div>
						<div class="truncate text-[11px] text-text-muted">Settings →</div>
					</div>
				</a>
			</div>
		{:else}
			<nav class="flex-1 px-5 py-3 text-sm text-text-muted">
				No project yet.
			</nav>

			<div class="border-t border-border px-5 py-3">
				<a
					href="/settings"
					class="flex items-center gap-2 text-sm text-dusk hover:text-midnight"
				>
					<div class="h-7 w-7 shrink-0 rounded-full bg-starlight" aria-hidden="true"></div>
					<div class="min-w-0 flex-1">
						<div class="truncate text-sm">You</div>
						<div class="truncate text-[11px] text-text-muted">Settings →</div>
					</div>
				</a>
			</div>
		{/if}
	</aside>

	<main class="bg-page-bg">
		{@render children()}
	</main>
</div>

{#if project}
	<dialog
		bind:this={deleteDialog}
		class="rounded-xl border border-border bg-card-bg p-0 backdrop:bg-midnight/40"
	>
		<form
			method="POST"
			action="/?/deleteProject"
			class="flex w-[440px] max-w-full flex-col gap-4 p-6"
		>
			<h2 class="text-[16px] font-semibold text-midnight">
				Delete "{project.name}"?
			</h2>
			<div class="flex flex-col gap-2 text-[13px] text-dusk">
				<p>This permanently removes:</p>
				<ul class="ml-4 list-disc space-y-0.5 text-[12px]">
					<li>The project directory on disk</li>
					<li>All topics, sources, agent runs, signals, and discovery reports</li>
				</ul>
				<p class="text-red-thread">This cannot be undone.</p>
			</div>

			<input type="hidden" name="id" value={project.id} />
			<input type="hidden" name="confirmName" value={confirmTyped} />

			<label class="flex flex-col gap-1.5">
				<span class="text-[11px] font-medium uppercase tracking-wider text-text-muted">
					Type the project name to confirm
				</span>
				<input
					bind:this={confirmInput}
					type="text"
					bind:value={confirmTyped}
					autocomplete="off"
					class="rounded-md border border-border bg-page-bg px-2 py-1.5 text-sm text-midnight outline-none focus:border-dusk"
				/>
			</label>

			<div class="flex items-center justify-end gap-2">
				<button
					type="button"
					onclick={closeDelete}
					class="rounded-md border border-border px-3 py-1.5 text-sm text-dusk hover:bg-cloud"
				>
					Cancel
				</button>
				<button
					type="submit"
					disabled={!confirmMatches}
					class="rounded-md bg-red-thread px-3 py-1.5 text-sm font-medium text-cloud hover:opacity-90 disabled:opacity-40"
				>
					Delete project
				</button>
			</div>
		</form>
	</dialog>
{/if}
