<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import EtaBadge from '$lib/components/EtaBadge.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { laneLabel, riskLabel, riskTone } from '$lib/yoroi/labels';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	const headOfLine = $derived(data.queue[0]?.pr.prNumber ?? null);
</script>

<svelte:head><title>{m.queue_title()} — {m.app_name()}</title></svelte:head>

<header>
	<h1>{m.queue_title()}</h1>
	<p>{m.queue_subtitle()}</p>
</header>

{#if data.queue.length === 0}
	<p>{m.queue_empty()}</p>
{:else}
	{#if headOfLine}
		<p class="notice">{m.queue_head_of_line({ pr: `#${headOfLine}` })}</p>
	{/if}
	<table>
		<thead>
			<tr>
				<th>{m.queue_col_position()}</th>
				<th>{m.queue_col_pr()}</th>
				<th>{m.queue_col_lane()}</th>
				<th>{m.queue_col_risk()}</th>
				<th>{m.queue_col_aging()}</th>
				<th>{m.queue_col_candidate_sha()}</th>
				<th>{m.queue_col_ci()}</th>
				<th>{m.queue_col_rebuild_count()}</th>
				<th>{m.queue_col_eta()}</th>
			</tr>
		</thead>
		<tbody>
			{#each data.queue as entry (entry.pr.repoId + '/' + entry.pr.prNumber)}
				<tr>
					<td>{entry.position}</td>
					<td>
						<a href={`/pr/${entry.pr.repoId}/${entry.pr.prNumber}`}>#{entry.pr.prNumber}</a>
						{entry.pr.title}
						{#if entry.rebuildNotice}
							<p class="hint">
								{m.queue_rebuild_notice({
									cause: `#${entry.rebuildNotice.causePr}`,
									affected: `#${entry.pr.prNumber}`
								})}
							</p>
						{/if}
					</td>
					<td>{laneLabel(entry.lane)}</td>
					<td><StatusBadge tone={riskTone(entry.risk)} label={riskLabel(entry.risk)} /></td>
					<td>{m.common_minutes({ n: entry.agingMinutes })}</td>
					<td><code>{entry.candidateSha}</code></td>
					<td>{entry.runningChecks.join(', ') || m.common_none()}</td>
					<td>{entry.rebuildCount}</td>
					<td><EtaBadge eta={entry.eta} /></td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		text-align: left;
		padding: 0.5rem 0.6rem;
		border-bottom: 1px solid var(--yoroi-border, #d0d7de);
		vertical-align: top;
	}
	.hint {
		margin: 0.2rem 0 0 0;
		font-size: 0.8rem;
		color: var(--yoroi-muted, #6e7781);
	}
	.notice {
		background: var(--win-button-highlight, #fff);
		color: var(--yoroi-amber, #808000);
		font-weight: bold;
		box-shadow: var(--win-border-field, inset -1px -1px #fff, inset 1px 1px #808080);
		padding: 0.5rem 0.75rem;
		border-radius: 0;
	}
</style>
