<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const topic = $derived(data.topic);
	const reports = $derived(data.reports);
	const sources = $derived(data.sources);
	const sourceCount = $derived(data.sourceCount);
	const pendingReportCount = $derived(data.pendingReportCount);

	const pendingReports = $derived(reports.filter((r) => r.status === 'pending'));
	const reviewedReports = $derived(reports.filter((r) => r.status === 'reviewed'));
	const dismissedReports = $derived(reports.filter((r) => r.status === 'dismissed'));

	function runLabel(createdAt: string): string {
		const d = new Date(createdAt);
		const month = d.toLocaleString('en', { month: 'short' });
		const day = String(d.getDate()).padStart(2, '0');
		const hour = d.getHours();
		const tod =
			hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
		return `${month}-${day} ${tod} run`;
	}

	function relative(iso: string): string {
		const then = new Date(iso).getTime();
		const now = Date.now();
		const diffSec = Math.max(0, Math.round((now - then) / 1000));
		if (diffSec < 60) return 'just now';
		if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
		if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
		const days = Math.floor(diffSec / 86400);
		if (days < 30) return `${days}d ago`;
		const months = Math.floor(days / 30);
		if (months < 12) return `${months}mo ago`;
		return `${Math.floor(months / 12)}y ago`;
	}
</script>

<section class="flex flex-col gap-6 px-9 pb-8 pt-7">
	<header class="flex flex-col gap-2.5">
		<a
			href="/"
			class="text-[11px] font-medium uppercase tracking-wider text-text-muted hover:text-dusk"
		>
			‹ Back to project
		</a>
		<h1 class="text-[28px] font-semibold leading-tight tracking-tight text-midnight">
			{topic.name}
		</h1>
		{#if topic.description}
			<p class="max-w-3xl text-sm leading-relaxed text-dusk">{topic.description}</p>
		{/if}
		{#if topic.narrativeThreads.length > 0}
			<div class="flex flex-wrap items-center gap-1.5">
				{#each topic.narrativeThreads as thread (thread)}
					<span
						class="rounded-full bg-cloud px-2.5 py-0.5 text-[10px] font-medium tracking-wide text-dusk"
					>
						{thread}
					</span>
				{/each}
			</div>
		{/if}
		<div class="flex items-center gap-[18px] text-xs font-medium text-dusk">
			<span>{sourceCount} {sourceCount === 1 ? 'source' : 'sources'}</span>
			{#if pendingReportCount > 0}
				<span class="h-[3px] w-[3px] rounded-full bg-mist"></span>
				<span
					class="inline-flex items-center gap-1.5 rounded-full bg-starlight px-[9px] py-[3px] text-[11px] font-semibold text-midnight"
				>
					<span class="h-[6px] w-[6px] rounded-full bg-midnight"></span>
					{pendingReportCount}
					{pendingReportCount === 1 ? 'report pending' : 'reports pending'}
				</span>
			{/if}
		</div>
	</header>

	<!-- REPORTS -->
	<section class="flex flex-col gap-3">
		<h2
			class="text-[11px] font-medium uppercase tracking-wider text-text-muted"
		>
			Reports
		</h2>

		{#if reports.length === 0}
			<div class="rounded-xl border border-dashed border-border bg-card-bg px-5 py-6 text-sm text-text-muted">
				No discovery runs yet. Run discover from the dashboard to get started.
			</div>
		{:else}
			<ul class="flex flex-col gap-2">
				{#each pendingReports as report (report.id)}
					<li>
						<a
							href={`/topics/${topic.id}/reports/${report.id}`}
							class="group flex items-center gap-4 rounded-xl border border-border bg-card-bg px-5 py-4 hover:border-midnight"
						>
							<span
								class="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-starlight px-[9px] py-[3px] text-[11px] font-semibold text-midnight"
							>
								<span class="h-[6px] w-[6px] rounded-full bg-midnight"></span>
								pending
							</span>
							<div class="flex-1">
								<div class="text-sm font-medium text-midnight">
									{runLabel(report.createdAt)}
								</div>
								<div class="text-[11px] text-dusk">
									{report.proposalCount}
									{report.proposalCount === 1 ? 'proposed source' : 'proposed sources'}
									· {report.auditFindingsCount}
									{report.auditFindingsCount === 1 ? 'audit finding' : 'audit findings'}
								</div>
							</div>
							<span class="text-[12px] font-medium text-dusk group-hover:text-midnight">
								Review report →
							</span>
						</a>
					</li>
				{/each}

				{#each reviewedReports as report (report.id)}
					<li class="flex items-center gap-4 rounded-xl border border-border bg-card-bg/60 px-5 py-3">
						<span class="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-dusk">
							<svg viewBox="0 0 12 12" class="h-3 w-3" aria-hidden="true">
								<path
									d="M3 6.5l2.25 2L9 4"
									stroke="currentColor"
									stroke-width="1.4"
									fill="none"
								/>
							</svg>
							reviewed
						</span>
						<div class="flex-1">
							<div class="text-[13px] text-dusk">{runLabel(report.createdAt)}</div>
							<div class="text-[11px] text-text-muted">
								{report.acceptedCount} accepted · {report.declinedCount} declined
							</div>
						</div>
					</li>
				{/each}

				{#each dismissedReports as report (report.id)}
					<li class="flex items-center gap-4 rounded-xl border border-border bg-card-bg/40 px-5 py-3">
						<span class="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-text-muted">
							<svg viewBox="0 0 12 12" class="h-3 w-3" aria-hidden="true">
								<path
									d="M3 3l6 6M9 3l-6 6"
									stroke="currentColor"
									stroke-width="1.2"
									fill="none"
								/>
							</svg>
							dismissed
						</span>
						<div class="flex-1">
							<div class="text-[13px] text-text-muted">{runLabel(report.createdAt)}</div>
							<div class="text-[11px] text-text-muted">no findings</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- SOURCES -->
	<section class="flex flex-col gap-3">
		<div class="flex items-baseline gap-2">
			<h2
				class="text-[11px] font-medium uppercase tracking-wider text-text-muted"
			>
				Sources
			</h2>
			<span class="text-[10px] font-medium tracking-wider text-text-muted">
				· {sourceCount}
			</span>
		</div>

		{#if sources.length === 0}
			<div class="rounded-xl border border-dashed border-border bg-card-bg px-5 py-6 text-sm text-text-muted">
				No sources yet. Sources are added by accepting proposals from a discovery
				report, or via the briefing card on topic create.
			</div>
		{:else}
			<ul class="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card-bg">
				{#each sources as source (source.id)}
					<li class="flex flex-col gap-1 px-5 py-3.5">
						<div class="flex items-center gap-2">
							{#if source.originalUrl}
								<a
									href={source.originalUrl}
									target="_blank"
									rel="noopener noreferrer"
									class="text-[14px] font-medium text-midnight hover:underline"
								>
									{source.title}
								</a>
							{:else}
								<span class="text-[14px] font-medium text-midnight">
									{source.title}
								</span>
							{/if}
							<span
								class="rounded-full bg-cloud px-2 py-0.5 text-[10px] font-medium tracking-wide text-dusk"
							>
								{source.type}
							</span>
						</div>
						<div class="flex items-center gap-2 text-[11px] text-text-muted">
							{#if source.provenance}
								<span>{source.provenance}</span>
								<span class="h-[3px] w-[3px] rounded-full bg-mist"></span>
							{/if}
							<span>{relative(source.createdAt)}</span>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</section>
