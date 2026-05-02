<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const project = $derived(data.project);
	const stats = $derived(data.stats);
	const topics = $derived(data.topics);

	let runningTopicId = $state<string | null>(null);
</script>

{#if !project}
	<section class="px-9 py-7">
		<h1 class="text-[28px] font-semibold tracking-tight text-midnight">No project yet</h1>
		<p class="mt-2 max-w-md text-sm text-dusk">
			Create a project via the Braindance CLI, or set
			<code class="rounded bg-cloud px-1 py-0.5 text-[12px]">BRAINDANCE_PROJECT_ID</code>
			to point at an existing one.
		</p>
	</section>
{:else}
	<section class="flex flex-col gap-6 px-9 pb-8 pt-7">
		<header class="flex items-start justify-between gap-4">
			<div class="flex flex-col gap-2.5">
				<h1 class="text-[28px] font-semibold leading-tight tracking-tight text-midnight">
					{project.name}
				</h1>
				<div class="flex items-center gap-[18px] text-xs font-medium text-dusk">
					<span>{stats!.topicCount} {stats!.topicCount === 1 ? 'topic' : 'topics'}</span>
					<span class="h-[3px] w-[3px] rounded-full bg-mist"></span>
					<span
						>{stats!.sourceCount}
						{stats!.sourceCount === 1 ? 'source' : 'sources'}</span
					>
					{#if stats!.pendingReports > 0}
						<span class="h-[3px] w-[3px] rounded-full bg-mist"></span>
						<span
							class="inline-flex items-center gap-1.5 rounded-full bg-starlight px-[9px] py-[3px] text-[11px] font-semibold text-midnight"
						>
							<span class="h-[6px] w-[6px] rounded-full bg-midnight"></span>
							{stats!.pendingReports}
							{stats!.pendingReports === 1 ? 'report pending' : 'reports pending'}
						</span>
					{/if}
				</div>
			</div>

			<div class="flex items-center gap-2.5">
				<button
					type="button"
					class="flex items-center gap-1.5 rounded-lg border border-border bg-card-bg px-3.5 py-2.5 text-sm font-medium text-dusk hover:bg-cloud"
					title="Topic creation lands with the briefing-card slice"
					disabled
				>
					<svg viewBox="0 0 14 14" class="h-3.5 w-3.5" aria-hidden="true">
						<path d="M7 3v8M3 7h8" stroke="currentColor" stroke-width="1.5" fill="none" />
					</svg>
					New topic
				</button>
				{#if stats!.pendingReports > 0}
					<button
						type="button"
						class="flex items-center gap-1.5 rounded-lg bg-midnight px-3.5 py-2.5 text-sm font-medium text-cloud"
						title="Signal Review lands in the next slice"
						disabled
					>
						<svg viewBox="0 0 14 14" class="h-3.5 w-3.5 text-starlight" aria-hidden="true">
							<path
								d="M3 7l2.5 2.5L11 4"
								stroke="currentColor"
								stroke-width="1.5"
								fill="none"
							/>
						</svg>
						Review pending
					</button>
				{/if}
			</div>
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
		{:else if form?.workflowRunId}
			<div
				class="rounded-lg border border-border bg-card-bg px-4 py-3 text-sm text-midnight"
			>
				Run started:
				<code class="ml-1 text-[11px] text-dusk">{form.workflowRunId}</code>
			</div>
		{/if}

		{#if topics.length === 0}
			<div class="rounded-xl border border-border bg-card-bg px-5 py-6 text-sm text-text-muted">
				No topics yet. Create one to start collecting sources.
			</div>
		{:else}
			<div class="grid grid-cols-2 gap-3.5">
				{#each topics as topic (topic.id)}
					<div class="flex flex-col gap-3 rounded-xl border border-border bg-card-bg p-5">
						<div class="flex items-start justify-between gap-2.5">
							<a
								href={`/topics/${topic.id}`}
								class="flex-1 text-[15px] font-semibold leading-snug text-midnight hover:underline"
							>
								{topic.name}
							</a>
							{#if topic.pendingReportCount > 0}
								<span
									class="rounded-full bg-starlight px-[7px] py-[2px] text-[10px] font-semibold text-midnight"
								>
									{topic.pendingReportCount === 1
										? 'report pending'
										: `${topic.pendingReportCount} reports pending`}
								</span>
							{/if}
						</div>

						{#if topic.narrativeThreads.length > 0}
							<div class="text-[10px] font-medium tracking-wide text-text-muted">
								{topic.narrativeThreads.join('  ·  ')}
							</div>
						{/if}

						<div class="flex items-center justify-between text-[11px] text-dusk">
							<span>
								{topic.sourceCount}
								{topic.sourceCount === 1 ? 'source' : 'sources'}
							</span>

							<form
								method="POST"
								action="?/runAddKnowledge"
								use:enhance={() => {
									runningTopicId = topic.id;
									return async ({ update }) => {
										await update({ reset: false });
										runningTopicId = null;
									};
								}}
							>
								<input type="hidden" name="topicId" value={topic.id} />
								<button
									type="submit"
									disabled={runningTopicId !== null}
									class="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-dusk hover:bg-cloud disabled:opacity-50"
								>
									{runningTopicId === topic.id ? 'Running…' : 'Run discover'}
								</button>
							</form>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
{/if}
