<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<svelte:head><title>{m.audit_title()} — {m.app_name()}</title></svelte:head>

<header>
	<h1>{m.audit_title()}</h1>
	<p>{m.audit_subtitle()}</p>
</header>

<form method="get" class="search">
	<label for="audit-q">{m.audit_search_label()}</label>
	<input
		id="audit-q"
		type="search"
		name="q"
		placeholder={m.audit_search_placeholder()}
		value={data.query}
	/>
	<button type="submit">{m.audit_search_button()}</button>
</form>

{#if data.results.length === 0}
	<p>{m.audit_empty()}</p>
{:else}
	<table>
		<thead>
			<tr>
				<th>{m.audit_col_time()}</th>
				<th>{m.audit_col_actor()}</th>
				<th>{m.audit_col_operation()}</th>
				<th>{m.audit_col_repo()}</th>
				<th>{m.audit_col_pr()}</th>
				<th>{m.audit_col_result()}</th>
			</tr>
		</thead>
		<tbody>
			{#each data.results as entry (entry.occurredAt + entry.actor + entry.operation)}
				<tr>
					<td>{entry.occurredAt}</td>
					<td>{entry.actor}</td>
					<td>{entry.operation}</td>
					<td>{entry.repo}</td>
					<td>{entry.prNumber ? `#${entry.prNumber}` : m.common_none()}</td>
					<td>{entry.result}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	.search {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.75rem 0 1.25rem 0;
	}
	.search input {
		flex: 1;
		max-width: 28rem;
		padding: 0.4rem 0.5rem;
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
