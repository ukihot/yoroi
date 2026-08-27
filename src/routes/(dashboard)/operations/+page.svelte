<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { healthComponentLabel, healthStatusLabel } from '$lib/yoroi/labels';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
	const allGreen = $derived(data.health.every((h) => h.status === 'green'));
</script>

<svelte:head><title>{m.ops_title()} — {m.app_name()}</title></svelte:head>

<header>
	<h1>{m.ops_title()}</h1>
	<p>{m.ops_subtitle()}</p>
</header>

{#if allGreen}
	<p class="all-green">{m.ops_all_green()}</p>
{/if}

<table>
	<thead>
		<tr>
			<th>{m.ops_col_component()}</th>
			<th>{m.ops_col_status()}</th>
			<th>{m.ops_col_reason()}</th>
			<th>{m.ops_col_updated_at()}</th>
		</tr>
	</thead>
	<tbody>
		{#each data.health as entry (entry.component)}
			<tr>
				<td>{healthComponentLabel(entry.component)}</td>
				<td><StatusBadge tone={entry.status} label={healthStatusLabel(entry.status)} /></td>
				<td>{entry.reason}</td>
				<td>{entry.updatedAt}</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	.all-green {
		color: var(--yoroi-green, #008000);
		font-weight: bold;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		text-align: left;
		padding: 0.5rem 0.6rem;
		border-bottom: 1px solid var(--yoroi-border, #d0d7de);
	}
</style>
