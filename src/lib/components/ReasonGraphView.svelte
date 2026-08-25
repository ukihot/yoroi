<script lang="ts">
	import type { ReasonGraphNode } from '$lib/server/yoroi/types';
	import ReasonGraphView from './ReasonGraphView.svelte';

	let { node }: { node: ReasonGraphNode } = $props();
</script>

<div class="node">
	<p class="label">{node.label}</p>
	{#if node.children.length > 0}
		<ul>
			{#each node.children as child (child.label)}
				<li><ReasonGraphView node={child} /></li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.node > .label {
		margin: 0;
	}
	ul {
		margin: 0.25rem 0 0 0;
		padding-left: 1.25rem;
		border-left: 2px solid var(--yoroi-border, #d0d7de);
	}
	li {
		margin: 0.35rem 0;
	}
</style>
