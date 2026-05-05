<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const models = $derived(data.models);
	const webSearch = $derived(data.webSearch);

	const modelsSaved = $derived(form?.section === 'models' && 'ok' in form && form.ok === true);
	const webSearchSaved = $derived(
		form?.section === 'web-search' && 'ok' in form && form.ok === true
	);
	const modelsError = $derived(
		form?.section === 'models' && 'error' in form ? form.error : null
	);
	const webSearchError = $derived(
		form?.section === 'web-search' && 'error' in form ? form.error : null
	);
</script>

<section class="flex flex-col gap-6 px-9 pb-8 pt-7">
	<header class="flex flex-col gap-2.5">
		<a href="/" class="text-[11px] font-medium uppercase tracking-wider text-text-muted hover:text-dusk">
			‹ Back
		</a>
		<h1 class="text-[28px] font-semibold leading-tight tracking-tight text-midnight">
			Settings
		</h1>
		<p class="max-w-xl text-sm text-dusk">
			User-controlled keys and model defaults. Stored locally in your registry database; never sent
			anywhere outside your machine.
		</p>
	</header>

	<form
		method="POST"
		action="?/saveModels"
		use:enhance
		class="flex flex-col gap-4 rounded-xl border border-border bg-card-bg p-6"
	>
		<div class="flex items-center justify-between">
			<h2 class="text-[15px] font-semibold text-midnight">Models</h2>
			<button
				type="submit"
				class="rounded-lg bg-midnight px-3.5 py-2 text-sm font-medium text-cloud hover:opacity-90"
			>
				Save models
			</button>
		</div>

		<label class="flex flex-col gap-1.5">
			<span class="text-[11px] font-medium uppercase tracking-wider text-text-muted">
				OpenRouter API key
			</span>
			{#if models.openrouter_key_masked}
				<div class="flex items-center gap-2 text-[12px] text-dusk">
					<code class="rounded bg-cloud px-2 py-1 font-mono">
						{models.openrouter_key_masked}
					</code>
					{#if models.openrouter_key_source === 'env'}
						<span class="text-text-muted">· from .env</span>
					{:else}
						<span class="text-text-muted">· stored</span>
					{/if}
				</div>
			{/if}
			<input
				type="password"
				name="openrouter_api_key"
				placeholder={models.openrouter_key_masked
					? 'Enter a new key to replace, or leave empty to clear stored value'
					: 'sk-or-v1-…'}
				autocomplete="off"
				class="rounded-lg border border-border bg-page-bg px-3 py-2 text-sm text-midnight outline-none focus:border-dusk"
			/>
		</label>

		<label class="flex flex-col gap-1.5">
			<span class="text-[11px] font-medium uppercase tracking-wider text-text-muted">
				Default model
			</span>
			<input
				type="text"
				name="default_model"
				value={models.default_model ?? ''}
				placeholder="moonshotai/kimi-k2.6"
				autocomplete="off"
				class="rounded-lg border border-border bg-page-bg px-3 py-2 text-sm text-midnight outline-none focus:border-dusk"
			/>
			<span class="text-[11px] text-text-muted">
				Used for discover, audit, and prune agents. Leave empty to use per-agent defaults.
			</span>
		</label>

		{#if modelsError}
			<div
				class="rounded-lg border border-red-thread/30 bg-red-thread/5 px-3 py-2 text-sm text-red-thread"
			>
				<div class="font-mono text-[11px] font-semibold uppercase tracking-wider">
					{modelsError.code}
				</div>
				<div class="mt-1 text-midnight">{modelsError.message}</div>
			</div>
		{:else if modelsSaved}
			<div class="text-[12px] text-dusk">Saved.</div>
		{/if}
	</form>

	<form
		method="POST"
		action="?/saveWebSearch"
		use:enhance
		class="flex flex-col gap-4 rounded-xl border border-border bg-card-bg p-6"
	>
		<div class="flex items-center justify-between">
			<h2 class="text-[15px] font-semibold text-midnight">Web search (Exa)</h2>
			<button
				type="submit"
				class="rounded-lg bg-midnight px-3.5 py-2 text-sm font-medium text-cloud hover:opacity-90"
			>
				Save web search
			</button>
		</div>

		<div class="text-[12px] text-dusk">
			{#if webSearch.exa_key_source === 'settings'}
				Using paid Exa endpoint with your API key.
			{:else if webSearch.exa_key_source === 'env'}
				Using paid Exa endpoint with key from <code class="rounded bg-cloud px-1 py-0.5 text-[11px]">.env</code>.
			{:else}
				Using free public Exa endpoint by default.
			{/if}
		</div>

		<label class="flex flex-col gap-1.5">
			<span class="text-[11px] font-medium uppercase tracking-wider text-text-muted">
				Exa API key (optional — paid features)
			</span>
			<input
				type="password"
				name="exa_api_key"
				placeholder={webSearch.exa_key_set
					? 'Enter a new key to replace, or leave empty to clear stored value'
					: 'Add a key to enable contents fetching and deeper crawl'}
				autocomplete="off"
				class="rounded-lg border border-border bg-page-bg px-3 py-2 text-sm text-midnight outline-none focus:border-dusk"
			/>
		</label>

		{#if webSearchError}
			<div
				class="rounded-lg border border-red-thread/30 bg-red-thread/5 px-3 py-2 text-sm text-red-thread"
			>
				<div class="font-mono text-[11px] font-semibold uppercase tracking-wider">
					{webSearchError.code}
				</div>
				<div class="mt-1 text-midnight">{webSearchError.message}</div>
			</div>
		{:else if webSearchSaved}
			<div class="text-[12px] text-dusk">Saved.</div>
		{/if}
	</form>
</section>
