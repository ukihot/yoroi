<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { queueModeLabel, repoStatusLabel } from '$lib/yoroi/labels';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();

	function statusTone(status: (typeof data.repos)[number]['status']) {
		return status === 'active' ? 'green' : status === 'paused' ? 'amber' : 'neutral';
	}
</script>

<svelte:head><title>{m.repos_title()} — {m.app_name()}</title></svelte:head>

<header>
	<h1>{m.repos_title()}</h1>
	<p>{m.repos_subtitle()}</p>
</header>

<table>
	<thead>
		<tr>
			<th>{m.repos_col_name()}</th>
			<th>{m.repos_col_mode()}</th>
			<th>{m.repos_col_status()}</th>
			<th>{m.repos_col_open_prs()}</th>
			<th>{m.repos_col_gate_pass_rate()}</th>
			<th>{m.repos_col_ci_success_rate()}</th>
			<th>{m.repos_col_p50_lead_time()}</th>
		</tr>
	</thead>
	<tbody>
		{#each data.repos as repo (repo.repoId)}
			<tr>
				<td><a href={`/repos/${repo.repoId}`}>{repo.name}</a></td>
				<td>{queueModeLabel(repo.mode)}</td>
				<td><StatusBadge tone={statusTone(repo.status)} label={repoStatusLabel(repo.status)} /></td>
				<td>{repo.openPrs}</td>
				<td>{m.common_percent({ n: repo.gatePassRatePct })}</td>
				<td>{m.common_percent({ n: repo.ciSuccessRatePct })}</td>
				<td>{m.common_minutes({ n: repo.p50LeadTimeMinutes })}</td>
			</tr>
		{/each}
	</tbody>
</table>

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
	}
</style>
