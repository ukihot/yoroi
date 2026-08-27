<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import {
		candidateInvalidationReasonLabel,
		flakyStatusLabel,
		flakyStatusTone
	} from '$lib/yoroi/labels';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
	const ci = $derived(data.ci);
</script>

<svelte:head><title>{m.ci_title()} — {m.app_name()}</title></svelte:head>

<header>
	<h1>{m.ci_title()}</h1>
	<p>{m.ci_subtitle()}</p>
</header>

<h2>{m.ci_section_candidates()}</h2>
<dl class="stats">
	<div>
		<dt>{m.ci_stat_candidates_built()}</dt>
		<dd>{ci.candidatesBuilt}</dd>
	</div>
	<div>
		<dt>{m.ci_stat_candidates_invalidated()}</dt>
		<dd>{ci.candidatesInvalidated}</dd>
	</div>
</dl>
{#if ci.invalidationReasons.length > 0}
	<ul>
		{#each ci.invalidationReasons as row (row.reason)}
			<li>{candidateInvalidationReasonLabel(row.reason)}: {row.count}</li>
		{/each}
	</ul>
{/if}

<h2>{m.ci_section_flaky_tests()}</h2>
{#if ci.flakyTests.length === 0}
	<p>{m.ci_flaky_empty()}</p>
{:else}
	<table>
		<thead>
			<tr>
				<th>{m.ci_col_test()}</th>
				<th>{m.ci_col_repo()}</th>
				<th>{m.ci_col_owner_team()}</th>
				<th>{m.ci_col_failure_count()}</th>
				<th>{m.ci_col_reproduction_rate()}</th>
				<th>{m.ci_col_status()}</th>
				<th>{m.ci_col_quarantine_until()}</th>
			</tr>
		</thead>
		<tbody>
			{#each ci.flakyTests as row (row.testFingerprint)}
				<tr>
					<td><code>{row.testFingerprint}</code></td>
					<td>{row.repoName ?? m.common_unknown()}</td>
					<td>{row.ownerTeam ?? m.common_unknown()}</td>
					<td>{row.failureCount}</td>
					<td
						>{row.reproductionRatePct !== null
							? m.common_percent({ n: row.reproductionRatePct })
							: m.common_unknown()}</td
					>
					<td
						><StatusBadge
							tone={flakyStatusTone(row.status)}
							label={flakyStatusLabel(row.status)}
						/></td
					>
					<td
						>{row.quarantineUntil
							? new Date(row.quarantineUntil).toLocaleDateString()
							: m.common_none()}</td
					>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<p class="hint">{m.ci_gap_note()}</p>

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
		margin: 1rem 0 1rem 0;
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
