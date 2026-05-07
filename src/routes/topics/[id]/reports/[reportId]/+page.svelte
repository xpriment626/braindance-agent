<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const topic = $derived(data.topic);
	const report = $derived(data.report);
	const counts = $derived(data.counts);
	const signals = $derived(data.signals);

	const proposals = $derived(report.newSources);
	const pendingSignals = $derived(signals.filter((s) => s.status === 'pending'));
	const approvedSignals = $derived(signals.filter((s) => s.status === 'approved'));

	const isTerminal = $derived(report.status !== 'pending');
	const dismissAvailable = $derived(
		report.status === 'pending' && counts.sourcesAccepted === 0
	);

	let busyAction = $state<string | null>(null); // form key used to disable rows during in-flight enhance.

	function runLabel(createdAt: string): string {
		const d = new Date(createdAt);
		const month = d.toLocaleString('en', { month: 'short' });
		const day = String(d.getDate()).padStart(2, '0');
		const hour = d.getHours();
		const tod = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
		return `${month}-${day} ${tod} run`;
	}

	const SIGNAL_GLYPH: Record<string, string> = {
		stale: '⚠',
		fresh: '✦',
		contested: '❗',
		retracted: '🚫',
		gap: '🕳',
		consolidation: '🧩'
	};
</script>

<section class="flex min-h-screen flex-col">
	<div class="flex flex-1 flex-col gap-5 px-9 pb-32 pt-7">
		<header class="flex flex-col gap-2.5">
			<a
				href={`/topics/${topic.id}`}
				class="text-[11px] font-medium uppercase tracking-wider text-text-muted hover:text-dusk"
			>
				‹ {topic.name} › Reports
			</a>
			<div class="flex items-baseline gap-3">
				<h1 class="text-[24px] font-semibold leading-tight tracking-tight text-midnight">
					{runLabel(report.createdAt)}
				</h1>
				{#if report.status === 'pending'}
					<span
						class="inline-flex items-center gap-1.5 rounded-full bg-starlight px-[9px] py-[3px] text-[11px] font-semibold text-midnight"
					>
						<span class="h-[6px] w-[6px] rounded-full bg-midnight"></span>
						pending
					</span>
				{:else if report.status === 'reviewed'}
					<span
						class="inline-flex items-center gap-1 rounded-full border border-border bg-card-bg px-2 py-0.5 text-[11px] font-medium text-dusk"
					>
						✓ reviewed
					</span>
				{:else}
					<span
						class="inline-flex items-center gap-1 rounded-full border border-border bg-card-bg px-2 py-0.5 text-[11px] font-medium text-text-muted"
					>
						✕ dismissed
					</span>
				{/if}
			</div>
			<p class="text-[12px] text-dusk">
				{proposals.length}
				{proposals.length === 1 ? 'proposed source' : 'proposed sources'}
				· {pendingSignals.length + approvedSignals.length}
				{pendingSignals.length + approvedSignals.length === 1 ? 'audit finding' : 'audit findings'}
			</p>
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

		{#if report.status === 'dismissed'}
			<div class="rounded-xl border border-border bg-card-bg px-5 py-6 text-sm text-dusk">
				This report was dismissed. No proposals were promoted to sources.
			</div>
		{/if}

		<div class="grid grid-cols-[3fr_2fr] gap-4">
			<!-- SOURCES PANEL -->
			<div class="flex flex-col gap-3 rounded-xl border border-border bg-card-bg p-5">
				<div class="flex items-baseline gap-2">
					<h2 class="text-[11px] font-medium uppercase tracking-wider text-text-muted">
						Sources
					</h2>
					<span class="text-[10px] font-medium tracking-wider text-text-muted">
						· {counts.sourcesAccepted} accepted · {counts.sourcesDeclined} declined · {counts.sourcesPending} pending
					</span>
				</div>

				{#if proposals.length === 0}
					<p class="rounded-lg border border-dashed border-border px-4 py-5 text-[12px] leading-relaxed text-text-muted">
						No new sources proposed this run.
					</p>
				{:else}
					<ul class="flex flex-col gap-2.5">
						{#each proposals as proposal (proposal.index)}
							<li
								class="flex flex-col gap-2 rounded-lg border border-border bg-page-bg p-3"
								class:opacity-60={proposal.status !== 'pending'}
							>
								<div class="flex items-start justify-between gap-2">
									<div class="flex-1">
										<div class="text-[14px] font-medium leading-snug text-midnight">
											{#if proposal.url}
												<a
													href={proposal.url}
													target="_blank"
													rel="noopener noreferrer"
													class="hover:underline"
												>
													{proposal.title}
												</a>
											{:else}
												{proposal.title}
											{/if}
										</div>
										<div class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
											{#if proposal.channel}
												<span class="rounded-full bg-cloud px-2 py-0.5 font-medium tracking-wide text-dusk">
													{proposal.channel}
												</span>
											{/if}
											{#if proposal.scope}
												<span class="rounded-full bg-cloud px-2 py-0.5 font-medium tracking-wide text-dusk">
													{proposal.scope === 'on_thread' ? 'on-thread' : 'adjacent'}
												</span>
											{/if}
											{#if proposal.confidence !== undefined}
												<span class="font-mono">
													{proposal.confidence.toFixed(2)}
												</span>
											{/if}
										</div>
									</div>
									{#if proposal.status === 'pending' && !isTerminal}
										<div class="flex shrink-0 items-center gap-1.5">
											<form
												method="POST"
												action="?/acceptSource"
												use:enhance={({ formData }) => {
													busyAction = `accept-${formData.get('index')}`;
													return async ({ update }) => {
														await update({ reset: false });
														busyAction = null;
													};
												}}
											>
												<input type="hidden" name="index" value={proposal.index} />
												<button
													type="submit"
													disabled={busyAction !== null}
													class="rounded-md border border-border bg-card-bg px-2.5 py-1 text-[11px] font-medium text-midnight hover:bg-cloud disabled:opacity-40"
												>
													✓ accept
												</button>
											</form>
											<form
												method="POST"
												action="?/declineSource"
												use:enhance={({ formData }) => {
													busyAction = `decline-${formData.get('index')}`;
													return async ({ update }) => {
														await update({ reset: false });
														busyAction = null;
													};
												}}
											>
												<input type="hidden" name="index" value={proposal.index} />
												<button
													type="submit"
													disabled={busyAction !== null}
													class="rounded-md border border-border bg-card-bg px-2.5 py-1 text-[11px] font-medium text-text-muted hover:bg-cloud hover:text-red-thread disabled:opacity-40"
												>
													✕ decline
												</button>
											</form>
										</div>
									{:else}
										<span class="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
											{proposal.status}
										</span>
									{/if}
								</div>
								{#if proposal.relevanceRationale}
									<div class="text-[12px] leading-relaxed text-dusk">
										{proposal.relevanceRationale}
									</div>
								{/if}
								{#if proposal.threadAssociations && proposal.threadAssociations.length > 0}
									<div class="flex flex-wrap items-center gap-1">
										{#each proposal.threadAssociations as thread (thread)}
											<span class="rounded-full bg-cloud px-2 py-0.5 text-[10px] font-medium tracking-wide text-dusk">
												{thread}
											</span>
										{/each}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<!-- SIGNALS PANEL -->
			<div class="flex flex-col gap-3 rounded-xl border border-border bg-card-bg p-5">
				<div class="flex items-baseline gap-2">
					<h2 class="text-[11px] font-medium uppercase tracking-wider text-text-muted">
						Signals
					</h2>
					<span class="text-[10px] font-medium tracking-wider text-text-muted">
						· {counts.signalsApproved} approved · {counts.signalsDismissed} dismissed · {counts.signalsPending} pending
					</span>
				</div>

				{#if signals.length === 0}
					<p class="rounded-lg border border-dashed border-border px-4 py-5 text-[12px] leading-relaxed text-text-muted">
						No audit findings this run.
					</p>
				{:else}
					<ul class="flex flex-col gap-2.5">
						{#each signals as signal (signal.id)}
							<li
								class="flex flex-col gap-1.5 rounded-lg border border-border bg-page-bg p-3"
								class:opacity-60={signal.status !== 'pending'}
							>
								<div class="flex items-start justify-between gap-2">
									<div class="flex-1">
										<div class="flex items-center gap-1.5 text-[12px] font-medium text-midnight">
											<span aria-hidden="true">{SIGNAL_GLYPH[signal.signalType] ?? '·'}</span>
											<span class="capitalize">{signal.signalType}</span>
										</div>
										{#if signal.targetLabel}
											<div class="text-[12px] text-dusk">
												{signal.targetLabel}
											</div>
										{/if}
									</div>
									{#if signal.status === 'pending' && !isTerminal}
										<div class="flex shrink-0 items-center gap-1.5">
											<form
												method="POST"
												action="?/approveSignal"
												use:enhance={({ formData }) => {
													busyAction = `approve-${formData.get('signalId')}`;
													return async ({ update }) => {
														await update({ reset: false });
														busyAction = null;
													};
												}}
											>
												<input type="hidden" name="signalId" value={signal.id} />
												<button
													type="submit"
													disabled={busyAction !== null}
													class="rounded-md border border-border bg-card-bg px-2.5 py-1 text-[11px] font-medium text-midnight hover:bg-cloud disabled:opacity-40"
												>
													approve
												</button>
											</form>
											<form
												method="POST"
												action="?/dismissSignal"
												use:enhance={({ formData }) => {
													busyAction = `dismiss-${formData.get('signalId')}`;
													return async ({ update }) => {
														await update({ reset: false });
														busyAction = null;
													};
												}}
											>
												<input type="hidden" name="signalId" value={signal.id} />
												<button
													type="submit"
													disabled={busyAction !== null}
													class="rounded-md border border-border bg-card-bg px-2.5 py-1 text-[11px] font-medium text-text-muted hover:bg-cloud hover:text-red-thread disabled:opacity-40"
												>
													✕ dismiss
												</button>
											</form>
										</div>
									{:else}
										<span class="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
											{signal.status}
										</span>
									{/if}
								</div>
								{#if signal.reason}
									<div class="text-[12px] leading-relaxed text-dusk">
										{signal.reason}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>
	</div>

	<!-- FOOTER ACTION RAIL -->
	<div class="sticky bottom-0 flex items-center justify-between gap-4 border-t border-border bg-card-bg/95 px-9 py-3.5 backdrop-blur">
		<div class="flex flex-col gap-0.5 text-[11px] text-dusk">
			<span>
				▣ {counts.sourcesAccepted} sources accepted · {counts.sourcesDeclined} declined · {counts.sourcesPending} pending
			</span>
			<span>
				▣ {counts.signalsApproved} signals approved · {counts.signalsDismissed} dismissed · {counts.signalsPending} pending
			</span>
		</div>
		<div class="flex items-center gap-2">
			{#if isTerminal}
				<a
					href={`/topics/${topic.id}`}
					class="rounded-md bg-midnight px-3.5 py-2 text-sm font-medium text-cloud hover:opacity-90"
				>
					Back to topic →
				</a>
			{:else}
				{#if dismissAvailable}
					<form method="POST" action="?/dismissReport">
						<button
							type="submit"
							class="rounded-md border border-border px-3.5 py-2 text-sm text-dusk hover:bg-cloud"
						>
							Dismiss report
						</button>
					</form>
				{/if}
				<button
					type="button"
					disabled
					title="Per-report prune wires up in the next commit"
					class="rounded-md bg-midnight px-3.5 py-2 text-sm font-medium text-cloud opacity-40"
				>
					Apply {counts.signalsApproved} approved signals → prune
				</button>
			{/if}
		</div>
	</div>
</section>
