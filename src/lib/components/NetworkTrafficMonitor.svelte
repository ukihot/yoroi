<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as m from '$lib/paraglide/messages';

	// A single, app-lifetime PerformanceObserver — registered once here, not
	// re-created per navigation (that's what made an earlier version slow:
	// every navigation replayed the *entire* buffered resource list).
	const MAX_ENTRIES = 24;
	const VISIBLE_ROWS = 2;

	type ResourceEntry = { id: number; name: string; kb: number; ms: number };
	type Row = ResourceEntry | null;

	let entries = $state<ResourceEntry[]>([]);
	let entrySeq = 0;
	let observer: PerformanceObserver | undefined;

	function shortName(url: string): string {
		try {
			const path = new URL(url, location.href).pathname;
			return path.split('/').filter(Boolean).pop() || path;
		} catch {
			return url;
		}
	}

	onMount(() => {
		if (typeof PerformanceObserver === 'undefined') return;
		observer = new PerformanceObserver((list) => {
			const additions = list.getEntries().map((entry) => {
				const resource = entry as PerformanceResourceTiming;
				return {
					id: entrySeq++,
					name: shortName(resource.name),
					kb: resource.transferSize / 1024,
					ms: resource.duration
				};
			});
			if (additions.length === 0) return;
			entries = [...entries, ...additions].slice(-MAX_ENTRIES);
		});
		try {
			observer.observe({ type: 'resource', buffered: true });
		} catch {
			// Resource Timing isn't available everywhere — the log just stays
			// quiet rather than erroring.
		}
	});

	onDestroy(() => {
		observer?.disconnect();
	});

	// Always exactly VISIBLE_ROWS slots — padded with blanks up front when
	// there isn't enough real data yet — so this never changes height
	// depending on how much has loaded.
	const displayRows: Row[] = $derived.by(() => {
		const real = entries.slice(-VISIBLE_ROWS);
		const blanks: Row[] = Array.from({ length: VISIBLE_ROWS - real.length }, () => null);
		return [...blanks, ...real];
	});
</script>

<ul class="log" aria-hidden="true">
	{#each displayRows as row, i (row?.id ?? `blank-${i}`)}
		{#if row}
			<li>
				<span class="log-name">{row.name}</span>
				<span class="log-size">{row.kb.toFixed(1)}KB {row.ms.toFixed(0)}ms</span>
			</li>
		{:else}
			<li class="idle">{i === VISIBLE_ROWS - 1 && entries.length === 0 ? m.traffic_idle() : ''}</li>
		{/if}
	{/each}
</ul>

<style>
	/* Fills whatever fixed-height bar its parent (the dashboard taskbar)
	 * gives it — no positioning of its own. Always exactly two lines tall
	 * regardless of how much data has arrived; new lines settle in at the
	 * bottom and push the older one up, like the driver-loading log on a
	 * 90s Windows boot screen, not a perpetually scrolling ticker. */
	.log {
		height: 100%;
		box-sizing: border-box;
		margin: 0;
		list-style: none;
		padding: 0.2rem 0.8rem;
		display: flex;
		flex-direction: column;
		justify-content: center;
		overflow: hidden;
		font-family: var(--win-font-body);
		color: var(--win-text);
	}
	.log li {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		overflow: hidden;
		font-family: 'Courier New', Consolas, monospace;
		font-size: 0.68rem;
		line-height: 1.5;
		animation: row-in 0.2s ease-out;
	}
	.log li.idle {
		color: var(--yoroi-neutral, #4d4d4d);
		font-style: italic;
	}
	.log-name {
		/* Sits right next to the size instead of being shoved across the
		 * whole bar width by space-between — reads like one log line,
		 * "app.css 10.1KB 2032ms", not name ... huge gap ... numbers. */
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.log-size {
		flex: none;
		color: var(--yoroi-neutral, #4d4d4d);
	}

	@keyframes row-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.log li {
			animation: none;
		}
	}
</style>
