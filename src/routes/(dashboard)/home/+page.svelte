<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import StatTile from '$lib/components/StatTile.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import EtaBadge from '$lib/components/EtaBadge.svelte';
	import { responsibilityLabel, responsibilityTone } from '$lib/yoroi/labels';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<svelte:head><title>{m.home_title()} — {m.app_name()}</title></svelte:head>

<header>
	<h1>{m.home_title()}</h1>
	<p>{m.home_subtitle()}</p>
</header>

<section class="stats">
	<StatTile label={m.home_stat_organizations()} value={data.overview.organizations} />
	<StatTile label={m.home_stat_repositories()} value={data.overview.repositories} />
	<StatTile label={m.home_stat_open_prs()} value={data.overview.openPrs} />
	<StatTile label={m.home_stat_queued()} value={data.overview.queued} />
	<StatTile label={m.home_stat_gate_passed()} value={data.overview.gatePassed} />
	<StatTile label={m.home_stat_blocked()} value={data.overview.blocked} />
	<StatTile label={m.home_stat_high_risk()} value={data.overview.highRisk} />
	<StatTile label={m.home_stat_long_stalled()} value={data.overview.longStalled} />
	<StatTile label={m.home_stat_ci_failing_repos()} value={data.overview.ciFailingRepos} />
	<StatTile
		label={m.home_stat_rate_limit()}
		value={m.common_percent({ n: data.overview.rateLimitRemainingPct })}
	/>
</section>

<section>
	<h2>{m.home_section_recent_activity()}</h2>
	<ul class="recent">
		<li>{m.home_recent_merged()}: {data.overview.recent.merged}</li>
		<li>{m.home_recent_failed()}: {data.overview.recent.failed}</li>
		<li>{m.home_recent_auto_reverted()}: {data.overview.recent.autoReverted}</li>
	</ul>
</section>

<section>
	<h2>{m.home_section_blocked()}</h2>
	{#if data.blocked.length === 0}
		<p>{m.home_empty_blocked()}</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>{m.home_col_repo()}</th>
					<th>{m.home_col_pr()}</th>
					<th>{m.home_col_responsibility()}</th>
					<th>{m.home_col_reason()}</th>
					<th>{m.home_col_next_actor()}</th>
					<th>{m.home_col_eta()}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.blocked as entry (entry.pr.repoId + '/' + entry.pr.prNumber)}
					<tr>
						<td>{entry.pr.repo}</td>
						<td>
							<a href={`/pr/${entry.pr.repoId}/${entry.pr.prNumber}`}>#{entry.pr.prNumber}</a>
							{entry.pr.title}
						</td>
						<td>
							<StatusBadge
								tone={responsibilityTone(entry.responsibility)}
								label={responsibilityLabel(entry.responsibility)}
							/>
						</td>
						<td>{entry.reason}</td>
						<td>{entry.nextActor}</td>
						<td><EtaBadge eta={entry.eta} /></td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<style>
	.stats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
	}
	.recent {
		list-style: none;
		padding: 0;
		display: flex;
		gap: 1.5rem;
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
		vertical-align: top;
	}
</style>
