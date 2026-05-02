<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';
	import type { LayoutData } from './$types';

	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();

	const project = $derived(data.project);
	const topics = $derived(data.topics);
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="grid min-h-screen grid-cols-[16rem_1fr]">
	<aside
		class="flex flex-col border-r border-border bg-sidebar-bg"
	>
		<div class="px-5 py-6">
			<a href="/" class="block text-base font-semibold text-midnight">
				Braindance
			</a>
		</div>

		{#if project}
			<div class="px-5 py-3">
				<div class="text-[11px] font-medium uppercase tracking-wider text-text-muted">
					Project
				</div>
				<button
					type="button"
					class="mt-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-midnight hover:bg-cloud"
					title="Project picker (multi-project switching ships post-beta)"
				>
					<span class="truncate">{project.name}</span>
					<svg viewBox="0 0 12 12" class="h-3 w-3 text-text-muted" aria-hidden="true">
						<path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.25" fill="none" />
					</svg>
				</button>
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
		{:else}
			<div class="flex-1 px-5 py-6">
				<p class="text-sm text-text-muted">No project yet.</p>
				<p class="mt-2 text-xs text-text-muted">
					Set <code class="rounded bg-cloud px-1 py-0.5 text-[11px]">BRAINDANCE_PROJECT_ID</code>
					or create one via CLI to get started.
				</p>
			</div>
		{/if}

		<div class="border-t border-border px-5 py-3">
			<div class="flex items-center gap-2">
				<div
					class="h-7 w-7 shrink-0 rounded-full bg-starlight"
					aria-hidden="true"
				></div>
				<div class="min-w-0 flex-1">
					<div class="truncate text-sm text-midnight">You</div>
					<div class="truncate text-[11px] text-text-muted">Local mode</div>
				</div>
			</div>
		</div>
	</aside>

	<main class="bg-page-bg">
		{@render children()}
	</main>
</div>
