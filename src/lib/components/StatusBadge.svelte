<script lang="ts">
	let { tone, label }: { tone: 'green' | 'amber' | 'red' | 'neutral'; label: string } = $props();
</script>

<span class="badge tone-{tone}">{label}</span>

<style>
	.badge {
		display: inline-block;
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
	.tone-green {
		color: var(--yoroi-green, #008000);
	}
	.tone-amber {
		color: var(--yoroi-amber, #808000);
	}
	.tone-red {
		color: var(--yoroi-red, #800000);
	}
	.tone-neutral {
		color: var(--yoroi-neutral, #4d4d4d);
	}
</style>
