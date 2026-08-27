<script lang="ts">
	let { tone, label }: { tone: 'green' | 'amber' | 'red' | 'neutral'; label: string } = $props();
</script>

<span class="badge tone-{tone}">
	<span class="lamp" aria-hidden="true"></span>
	{label}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.05rem 0.5rem;
		border-radius: 0;
		font-family: var(--win-font-accent, 'Zen Old Mincho', serif);
		font-size: 0.75rem;
		font-weight: bold;
		line-height: 1.4;
		white-space: nowrap;
		background: var(--win-button-highlight, #fff);
		box-shadow: var(--win-border-field, inset -1px -1px #fff, inset 1px 1px #808080);
	}

	/* Old-school panel "pilot lamp" — the little plastic-bezel LED that used
	 * to sit on a router/UPS front panel: lit + glowing when there's
	 * something to report, dark when idle. Green additionally "breathes" so
	 * it reads as alive/running rather than just a colored dot, and red
	 * blinks like an alarm lamp rather than sitting there calmly. */
	.lamp {
		width: 0.55rem;
		height: 0.55rem;
		flex: none;
		border-radius: 50%;
		background: radial-gradient(circle at 30% 30%, #e6e6e6, #9a9a9a 70%);
		box-shadow:
			inset -1px -1px 1px rgba(255, 255, 255, 0.7),
			inset 1px 1px 1px rgba(0, 0, 0, 0.45);
	}
	.tone-green {
		color: var(--yoroi-green, #008000);
	}
	.tone-green .lamp {
		background: radial-gradient(circle at 30% 30%, #baffba, var(--yoroi-green, #008000) 70%);
		box-shadow:
			inset -1px -1px 1px rgba(255, 255, 255, 0.7),
			inset 1px 1px 1px rgba(0, 0, 0, 0.45),
			0 0 4px 1px var(--yoroi-green, #008000);
		animation: lamp-breathe 2.2s ease-in-out infinite;
	}
	.tone-amber {
		color: var(--yoroi-amber, #808000);
	}
	.tone-amber .lamp {
		background: radial-gradient(circle at 30% 30%, #fff7ba, var(--yoroi-amber, #808000) 70%);
		box-shadow:
			inset -1px -1px 1px rgba(255, 255, 255, 0.7),
			inset 1px 1px 1px rgba(0, 0, 0, 0.45),
			0 0 4px 1px var(--yoroi-amber, #808000);
	}
	.tone-red {
		color: var(--yoroi-red, #800000);
	}
	.tone-red .lamp {
		background: radial-gradient(circle at 30% 30%, #ffbaba, var(--yoroi-red, #800000) 70%);
		box-shadow:
			inset -1px -1px 1px rgba(255, 255, 255, 0.7),
			inset 1px 1px 1px rgba(0, 0, 0, 0.45),
			0 0 4px 1px var(--yoroi-red, #800000);
		animation: lamp-alert 1s steps(1, end) infinite;
	}
	.tone-neutral {
		color: var(--yoroi-neutral, #4d4d4d);
	}

	@keyframes lamp-breathe {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}
	@keyframes lamp-alert {
		0%,
		49% {
			opacity: 1;
		}
		50%,
		100% {
			opacity: 0.25;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.lamp {
			animation: none !important;
		}
	}
</style>
