<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { policySourceLabel, policySourceTone } from '$lib/yoroi/labels';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<svelte:head><title>{m.policy_title()} — {m.app_name()}</title></svelte:head>

<header>
	<h1>{m.policy_title()}</h1>
</header>

<h2>{m.policy_section_policy()}</h2>
<table>
	<thead>
		<tr>
			<th>{m.policy_col_repo()}</th>
			<th>{m.policy_col_source()}</th>
			<th>{m.policy_col_version()}</th>
			<th>{m.policy_col_digest()}</th>
			<th>{m.policy_col_published_at()}</th>
			<th>{m.policy_col_open_prs()}</th>
		</tr>
	</thead>
	<tbody>
		{#each data.repos as repo (repo.repoId)}
			<tr>
				<td>{repo.repoName}</td>
				<td>
					<StatusBadge
						tone={policySourceTone(repo.source)}
						label={policySourceLabel(repo.source)}
					/>
				</td>
				<td>{repo.version ?? m.common_unknown()}</td>
				<td><code>{repo.policyDigest}</code></td>
				<td
					>{repo.publishedAt
						? new Date(repo.publishedAt).toLocaleDateString()
						: m.common_unknown()}</td
				>
				<td>{repo.openPrCount}</td>
			</tr>
		{/each}
	</tbody>
</table>

<h2>{m.policy_section_github_config_and_drift()}</h2>
<p>{m.policy_placeholder()}</p>

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
</style>
