<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
	const load = $derived(data.reviewerLoad);
</script>

<svelte:head><title>{m.reviews_title()} — {m.app_name()}</title></svelte:head>

<header>
	<h1>{m.reviews_title()}</h1>
	<p>{m.reviews_subtitle()}</p>
</header>

<dl class="stats">
	<div>
		<dt>{m.reviews_stat_total_pending()}</dt>
		<dd>{load.totalPending}</dd>
	</div>
	<div>
		<dt>{m.reviews_stat_concentration()}</dt>
		<dd>{m.common_percent({ n: load.concentrationPct })}</dd>
	</div>
	<div>
		<dt>{m.reviews_stat_carry_forward_rate()}</dt>
		<dd>{m.common_percent({ n: load.carryForwardRatePct })}</dd>
	</div>
</dl>

{#if load.totalPending === 0}
	<p>{m.reviews_empty()}</p>
{:else}
	<h2>{m.reviews_section_by_scope()}</h2>
	<table>
		<thead>
			<tr>
				<th>{m.reviews_col_scope()}</th>
				<th>{m.reviews_col_pending()}</th>
				<th>{m.reviews_col_reviewers()}</th>
				<th>{m.reviews_col_backup()}</th>
			</tr>
		</thead>
		<tbody>
			{#each load.byScope as row (row.scope)}
				<tr>
					<td>{row.scope}</td>
					<td>{row.pendingCount}</td>
					<td>{row.reviewerCount}</td>
					<td>
						<StatusBadge
							tone={row.hasBackupReviewer ? 'green' : 'amber'}
							label={row.hasBackupReviewer ? m.common_yes() : m.common_no()}
						/>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<h2>{m.reviews_section_by_reviewer()}</h2>
	<table>
		<thead>
			<tr>
				<th>{m.reviews_col_reviewer()}</th>
				<th>{m.reviews_col_pending()}</th>
				<th>{m.reviews_col_sensitive_count()}</th>
				<th>{m.reviews_col_oldest_waiting()}</th>
			</tr>
		</thead>
		<tbody>
			{#each load.byReviewer as row (row.actor)}
				<tr>
					<td>{row.actor}</td>
					<td>{row.pendingCount}</td>
					<td>{row.sensitiveCount}</td>
					<td>{m.common_minutes({ n: row.oldestWaitingMinutes })}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<p class="hint">{m.reviews_gap_note()}</p>

<style>
	table {
		width: 100%;
		border-collapse: collapse;
		margin-bottom: 1.5rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.5rem 0.6rem;
		border-bottom: 1px solid var(--yoroi-border, #d0d7de);
		vertical-align: top;
	}
	.stats {
		display: flex;
		gap: 2rem;
		margin: 1rem 0 1.5rem 0;
	}
	.stats dt {
		font-size: 0.8rem;
		color: var(--yoroi-muted, #6e7781);
	}
	.stats dd {
		margin: 0;
		font-size: 1.4rem;
		font-weight: 600;
	}
	.hint {
		margin-top: 1rem;
		font-size: 0.8rem;
		color: var(--yoroi-muted, #6e7781);
	}
</style>
