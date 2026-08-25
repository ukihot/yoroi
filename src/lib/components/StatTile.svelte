<script lang="ts">
	let { label, value }: { label: string; value: string | number } = $props();
</script>

<div class="tile">
	<p class="value">{value}</p>
	<p class="label">{label}</p>
</div>

<style>
	.tile {
		border: 1px solid var(--yoroi-border, #d0d7de);
		border-radius: 8px;
		padding: 0.75rem 1rem;
		min-width: 8rem;
	}
	.value {
		margin: 0;
		font-size: 1.6rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.label {
		margin: 0.15rem 0 0 0;
		font-size: 0.8rem;
		color: var(--yoroi-muted, #6e7781);
	}
</style>
