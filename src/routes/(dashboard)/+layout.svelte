<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages';
	import NetworkTrafficMonitor from '$lib/components/NetworkTrafficMonitor.svelte';
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
		<p class="brand">
			<span class="blink" aria-hidden="true">☆</span>
			{m.app_name()}
			<span class="blink" aria-hidden="true">☆</span>
		</p>
		<p class="marquee-tagline marquee"><span>{m.app_marquee_tagline()}</span></p>
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
								<span class="badge blink" title={m.app_needs_attention()}>{item.badge}</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		</nav>
		<div class="rainbow-rule" role="presentation"></div>
	</aside>
	<main>
		{@render children()}
	</main>
</div>

<!-- A Win95-taskbar layout: the settings/account button occupies the
     Start-button slot on the left, the live network log takes the rest —
     same row, same fixed bar, instead of two separate footers. -->
<div class="taskbar">
	<a
		class="account"
		href={resolve('/settings')}
		aria-current={page.url.pathname.startsWith('/settings') ? 'page' : undefined}
	>
		<span class="account-name">{data.user.name}</span>
		<span class="account-hint">{m.nav_settings()}</span>
	</a>
	<NetworkTrafficMonitor />
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: 14rem 1fr;
		/* Leave room for the fixed taskbar below so it never covers the
		 * bottom of the sidebar or the page content. */
		min-height: calc(100vh - var(--yoroi-traffic-footer-h, 3rem));
	}
	aside {
		background: var(--win-surface, #c0c0c0);
		box-shadow:
			inset -2px 0 var(--win-button-shadow, #808080),
			inset -1px 0 var(--win-window-frame, #0a0a0a);
		padding: 0 0 1rem 0;
	}
	.brand {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		font-family: var(--win-font-accent, 'Zen Old Mincho', serif);
		font-size: 0.95rem;
		font-weight: bold;
		margin: 0;
		padding: 0.4rem 0.6rem;
		background: linear-gradient(
			90deg,
			var(--win-dialog-blue, #000080),
			var(--win-dialog-blue-light, #1084d0)
		);
		color: #fff;
	}
	.marquee-tagline {
		margin: 0 0 1rem 0;
		padding: 0.2rem 0.6rem;
		font-family: var(--win-font-party);
		font-size: 0.7rem;
		color: var(--win-dialog-blue, #000080);
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
	.taskbar {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 999;
		height: var(--yoroi-traffic-footer-h, 3rem);
		display: grid;
		grid-template-columns: 14rem 1fr;
		background: var(--win-surface, #c0c0c0);
		box-shadow:
			inset 0 1px var(--win-button-highlight, #fff),
			inset 0 2px var(--win-button-shadow, #808080);
	}
	.account {
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 0.1rem;
		padding: 0.3rem 0.6rem;
		box-shadow:
			inset -1px 0 var(--win-button-shadow, #808080),
			inset -2px 0 var(--win-window-frame, #0a0a0a);
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
