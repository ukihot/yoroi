<script lang="ts">
	let { tone, label }: { tone: 'green' | 'amber' | 'red' | 'neutral'; label: string } = $props();
</script>

<span class="badge tone-{tone}">{label}</span>

<style>
	.badge {
		display: inline-block;
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 600;
		line-height: 1.4;
		white-space: nowrap;
	}
	.tone-green {
		background: color-mix(in srgb, #1a7f37 15%, transparent);
		color: #1a7f37;
	}
	.tone-amber {
		background: color-mix(in srgb, #9a6700 15%, transparent);
		color: #9a6700;
	}
	.tone-red {
		background: color-mix(in srgb, #cf222e 15%, transparent);
		color: #cf222e;
	}
	.tone-neutral {
		background: color-mix(in srgb, #6e7781 15%, transparent);
		color: #6e7781;
	}
</style>
