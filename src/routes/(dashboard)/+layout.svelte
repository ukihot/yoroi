<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import type { LayoutServerData } from './$types';

	let { data, children }: { data: LayoutServerData; children: Snippet } = $props();

	const navItems = $derived([
		{ href: '/home', label: m.nav_home() },
		{ href: '/my-work', label: m.nav_my_work(), badge: data.needsAttentionCount },
		{ href: '/repos', label: m.nav_repositories() },
		{ href: '/queue', label: m.nav_merge_queue() },
		{ href: '/ci', label: m.nav_ci_reliability() },
		{ href: '/reviews', label: m.nav_reviews() },
		{ href: '/policy', label: m.nav_policy_drift() },
		{ href: '/operations', label: m.nav_operations() },
		{ href: '/audit', label: m.nav_audit() }
	]);
</script>

<div class="shell">
	<aside>
		<p class="brand">{m.app_name()}</p>
		<nav>
			<ul>
				{#each navItems as item (item.href)}
					<li>
						<a
							href={item.href}
							aria-current={page.url.pathname.startsWith(item.href) ? 'page' : undefined}
						>
							{item.label}
							{#if item.badge}
								<span class="badge" title={m.app_needs_attention()}>{item.badge}</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
		<a
			class="account"
			href={resolve('/settings')}
			aria-current={page.url.pathname.startsWith('/settings') ? 'page' : undefined}
		>
			<span class="account-name">{data.user.name}</span>
			<span class="account-hint">{m.nav_settings()}</span>
		</a>
	</aside>
	<main>
		{@render children()}
	</main>
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: 14rem 1fr;
		min-height: 100vh;
	}
	aside {
		background: var(--win-surface, #c0c0c0);
		box-shadow:
			inset -2px 0 var(--win-button-shadow, #808080),
			inset -1px 0 var(--win-window-frame, #0a0a0a);
		padding: 0 0 1rem 0;
		display: flex;
		flex-direction: column;
	}
	.brand {
		font-family: var(--win-font-accent, 'Zen Old Mincho', serif);
		font-size: 0.95rem;
		font-weight: bold;
		margin: 0 0 1rem 0;
		padding: 0.4rem 0.6rem;
		background: linear-gradient(
			90deg,
			var(--win-dialog-blue, #000080),
			var(--win-dialog-blue-light, #1084d0)
		);
		color: #fff;
	}
	nav ul {
		list-style: none;
		margin: 0;
		padding: 0 0.5rem;
	}
	nav a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.35rem 0.6rem;
		border-radius: 0;
		text-decoration: none;
		color: inherit;
	}
	nav a[aria-current='page'] {
		background: var(--win-dialog-blue, #000080);
		color: #fff;
		font-weight: normal;
	}
	.badge {
		background: var(--yoroi-red-bg, #c0c0c0);
		color: var(--yoroi-red, #800000);
		border-radius: 0;
		font-size: 0.7rem;
		font-weight: bold;
		padding: 0 0.35rem;
		box-shadow: var(--win-border-field, inset -1px -1px #fff, inset 1px 1px #808080);
	}
	.account {
		margin-top: auto;
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		padding: 0.75rem 0.6rem;
		box-shadow:
			inset 0 1px var(--win-button-highlight, #fff),
			inset 0 2px var(--win-button-shadow, #808080);
		font-size: 0.85rem;
		text-decoration: none;
		color: inherit;
	}
	.account:hover,
	.account[aria-current='page'] {
		background: var(--win-dialog-blue, #000080);
		color: #fff;
	}
	.account-name {
		font-weight: bold;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.account-hint {
		font-size: 0.75rem;
		opacity: 0.8;
	}
	main {
		padding: 1.5rem 2rem;
		overflow-x: auto;
	}
</style>
