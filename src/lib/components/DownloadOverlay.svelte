<script lang="ts">
	import { beforeNavigate, afterNavigate } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';

	// Most SvelteKit navigations resolve in well under this, so the HUD is a
	// fallback for the rare slow one — not a procedural step that runs on
	// every click. Nothing is shown at all unless a navigation is still in
	// flight after this delay. Kept deliberately cheap: no Resource Timing
	// capture here — that turned out slow enough to matter, so it now lives
	// on its own in NetworkTrafficMonitor instead, decoupled from this
	// go/no-go fallback timer.
	const SHOW_DELAY_MS = 200;

	let visible = $state(false);
	let elapsedSeconds = $state(0);

	let navStartedAt = 0; // performance.now() timestamp; 0 while idle
	let showTimer: ReturnType<typeof setTimeout> | undefined;
	let tickTimer: ReturnType<typeof setInterval> | undefined;

	function reset() {
		clearTimeout(showTimer);
		clearInterval(tickTimer);
		navStartedAt = 0;
		visible = false;
		elapsedSeconds = 0;
	}

	// beforeNavigate fires synchronously, before SvelteKit dispatches any
	// load-function fetches.
	beforeNavigate(() => {
		navStartedAt = performance.now();
		showTimer = setTimeout(() => {
			visible = true;
			tickTimer = setInterval(() => {
				elapsedSeconds = (performance.now() - navStartedAt) / 1000;
			}, 100);
		}, SHOW_DELAY_MS);
	});

	// Fires once the navigation completes (also once on initial mount, when
	// reset() below is a harmless no-op) — no artificial minimum display time.
	afterNavigate(() => {
		if (navStartedAt) reset();
	});
</script>

{#if visible}
	<div class="download-hud">
		<div class="hud-header">
			<span class="pulse" aria-hidden="true"></span>
			<span class="hud-elapsed" aria-hidden="true"
				>{m.loading_elapsed({ seconds: elapsedSeconds.toFixed(1) })}</span
			>
		</div>
		<div class="hud-progress" aria-hidden="true">
			<div class="hud-progress-fill"></div>
		</div>
		<p class="sr-status" role="status" aria-live="polite">
			{m.loading_status()}
			{m.loading_elapsed({ seconds: elapsedSeconds.toFixed(1) })}
		</p>
	</div>
{/if}

<style>
	/* Plain Win95 chrome, same tokens as the rest of the app — no blur, no
	 * glow, no rounded corners. A small "system tray balloon" style panel. */
	.download-hud {
		position: fixed;
		right: 1rem;
		bottom: calc(var(--yoroi-traffic-footer-h, 3rem) + 1rem);
		z-index: 1000;
		width: 12rem;
		max-width: calc(100vw - 2rem);
		background: var(--win-surface, #c0c0c0);
		box-shadow:
			var(--win-border-raised-outer, inset -1px -1px #0a0a0a),
			var(--win-border-raised-inner, inset 1px 1px #dfdfdf);
		font-family: var(--win-font-body);
		font-size: 12px;
		color: var(--win-text);
	}
	.hud-header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.5rem;
	}
	/* Same pilot-lamp look as StatusBadge's "running" lamp. */
	.pulse {
		flex: none;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: radial-gradient(circle at 30% 30%, #baffba, var(--yoroi-green, #008000) 70%);
		box-shadow:
			inset -1px -1px 1px rgba(255, 255, 255, 0.7),
			inset 1px 1px 1px rgba(0, 0, 0, 0.45),
			0 0 3px 1px var(--yoroi-green, #008000);
		animation: pulse-breathe 2.2s ease-in-out infinite;
	}
	.hud-elapsed {
		margin-left: auto;
		font-family: 'Courier New', monospace;
		font-size: 0.7rem;
	}
	.hud-progress {
		height: 6px;
		margin: 0 0.5rem 0.4rem 0.5rem;
		background: var(--win-button-highlight, #fff);
		box-shadow: var(--win-border-field, inset 1px 1px #808080);
	}
	.hud-progress-fill {
		height: 100%;
		background-image: repeating-linear-gradient(
			45deg,
			var(--yoroi-green, #008000) 0 6px,
			var(--win-button-highlight, #fff) 6px 12px
		);
		animation: progress-scroll 0.6s linear infinite;
	}
	.sr-status {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	@keyframes pulse-breathe {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}
	@keyframes progress-scroll {
		from {
			background-position: 0 0;
		}
		to {
			background-position: 12px 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pulse,
		.hud-progress-fill {
			animation: none;
		}
	}
</style>
