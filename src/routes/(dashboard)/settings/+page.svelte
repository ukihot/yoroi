<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import type { Pathname } from '$app/types';
	import * as m from '$lib/paraglide/messages';
	import { getLocale, locales, localizeHref } from '$lib/paraglide/runtime';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const THEMES = [
		{ id: 'standard', label: m.settings_theme_standard() },
		{ id: 'hotdog-stand', label: m.settings_theme_hotdog_stand() },
		{ id: 'rainy-day', label: m.settings_theme_rainy_day() }
	] as const;

	const localeLabels: Record<string, () => string> = {
		ja: m.settings_lang_ja,
		en: m.settings_lang_en
	};

	let currentTheme = $state('standard');

	$effect(() => {
		try {
			currentTheme = localStorage.getItem('yoroi-theme') ?? 'standard';
		} catch {
			// localStorage unavailable (private browsing etc.) — stay on the default.
		}
	});

	function applyTheme(id: string) {
		currentTheme = id;
		document.documentElement.dataset.theme = id;
		try {
			localStorage.setItem('yoroi-theme', id);
		} catch {
			// best-effort only — the theme still applies for this page view.
		}
	}
</script>

<svelte:head><title>{m.settings_title()} — {m.app_name()}</title></svelte:head>

<header>
	<h1>{m.settings_title()}</h1>
</header>

<fieldset>
	<legend>{m.settings_section_language()}</legend>
	<div class="field-row">
		{#each locales as locale (locale)}
			<a
				href={resolve(localizeHref(page.url.pathname, { locale }) as Pathname)}
				aria-current={getLocale() === locale ? 'page' : undefined}
			>
				{localeLabels[locale]?.() ?? locale}
			</a>
		{/each}
	</div>
</fieldset>

<fieldset>
	<legend>{m.settings_section_theme()}</legend>
	<div class="field-row-stacked">
		{#each THEMES as theme (theme.id)}
			<label>
				<input
					type="radio"
					name="theme"
					value={theme.id}
					checked={currentTheme === theme.id}
					onchange={() => applyTheme(theme.id)}
				/>
				{theme.label}
			</label>
		{/each}
	</div>
</fieldset>

<fieldset>
	<legend>{m.settings_section_account()}</legend>
	<p>{m.common_signed_in_as({ name: data.user.name })}</p>
	<form method="post" action="/logout" use:enhance>
		<button type="submit">{m.common_sign_out()}</button>
	</form>
</fieldset>

<style>
	fieldset {
		margin-bottom: 1.25rem;
		padding: 0.75rem 1rem 1rem 1rem;
		max-width: 24rem;
	}
	legend {
		padding: 0 0.4rem;
		/* fieldset's border comes from a box-shadow (app.css), not a real
		 * border, so the browser never punches a gap for the legend — the
		 * shadow line runs straight across and shows through the label
		 * text unless the legend masks it with an opaque background. */
		background: var(--win-surface);
	}
	.field-row {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.field-row a {
		text-decoration: none;
	}
	.field-row a[aria-current='page'] {
		font-weight: bold;
		text-decoration: underline;
	}
	.field-row-stacked {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.field-row-stacked label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
</style>
