<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
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
						<a href={item.href} aria-current={page.url.pathname.startsWith(item.href) ? 'page' : undefined}>
							{item.label}
							{#if item.badge}
								<span class="badge" title={m.app_needs_attention()}>{item.badge}</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
		<div class="account">
			<p>{m.common_signed_in_as({ name: data.user.name })}</p>
			<form method="post" action="/logout" use:enhance>
				<button type="submit">{m.common_sign_out()}</button>
			</form>
		</div>
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
		border-right: 1px solid var(--yoroi-border, #d0d7de);
		padding: 1rem;
		display: flex;
		flex-direction: column;
	}
	.brand {
		font-weight: 700;
		margin: 0 0 1rem 0;
	}
	nav ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	nav a {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.45rem 0.6rem;
		border-radius: 6px;
		text-decoration: none;
		color: inherit;
	}
	nav a[aria-current='page'] {
		background: color-mix(in srgb, currentColor 10%, transparent);
		font-weight: 600;
	}
	.badge {
		background: #cf222e;
		color: #fff;
		border-radius: 999px;
		font-size: 0.7rem;
		padding: 0.05rem 0.4rem;
	}
	.account {
		margin-top: auto;
		padding-top: 1rem;
		border-top: 1px solid var(--yoroi-border, #d0d7de);
		font-size: 0.85rem;
	}
	main {
		padding: 1.5rem 2rem;
		overflow-x: auto;
	}
</style>
