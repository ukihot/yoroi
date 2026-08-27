<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import EtaBadge from '$lib/components/EtaBadge.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { checkConclusionLabel, checkConclusionTone, stageLabel } from '$lib/yoroi/labels';
	import type { PageServerData } from './$types';

	let { data }: { data: PageServerData } = $props();
</script>

<svelte:head><title>{m.mywork_title()} — {m.app_name()}</title></svelte:head>

<header>
	<h1>{m.mywork_title()}</h1>
	<p>{m.mywork_subtitle()}</p>
</header>

<section>
	<h2>{m.mywork_section_created()}</h2>
	{#if data.myWork.authored.length === 0}
		<p>{m.mywork_empty_created()}</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>{m.mywork_col_pr()}</th>
					<th>{m.mywork_col_stage()}</th>
					<th>{m.mywork_col_approvals()}</th>
					<th>{m.mywork_col_ci()}</th>
					<th>{m.mywork_col_queue_position()}</th>
					<th>{m.mywork_col_eta()}</th>
					<th>{m.mywork_col_blocking_reason()}</th>
					<th>{m.mywork_col_next_action()}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.myWork.authored as item (item.pr.repoId + '/' + item.pr.prNumber)}
					<tr>
						<td>
							<a href={`/pr/${item.pr.repoId}/${item.pr.prNumber}`}>#{item.pr.prNumber}</a>
							{item.pr.title}
							{#if item.revokedScopes}
								<p class="hint">
									{m.mywork_carry_forward_revoked({
										scopes: item.revokedScopes.scopes.join(', '),
										reason: item.revokedScopes.reason
									})}
								</p>
							{/if}
							{#if item.maintainedScopes.length > 0}
								<p class="hint">
									{m.mywork_carry_forward_maintained({ scopes: item.maintainedScopes.join(', ') })}
								</p>
							{/if}
						</td>
						<td>{stageLabel(item.stage)}</td>
						<td
							>{m.mywork_approvals_progress({
								approved: item.approvalsApproved,
								required: item.approvalsRequired
							})}</td
						>
						<td
							><StatusBadge
								tone={checkConclusionTone(item.ci)}
								label={checkConclusionLabel(item.ci)}
							/></td
						>
						<td>{item.queuePosition ?? m.common_none()}</td>
						<td><EtaBadge eta={item.eta} /></td>
						<td>{item.blockingReason ?? m.common_none()}</td>
						<td>{item.nextAction}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<section>
	<h2>{m.mywork_section_reviewing()}</h2>
	{#if data.myWork.reviewing.length === 0}
		<p>{m.mywork_empty_reviewing()}</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>{m.mywork_col_pr()}</th>
					<th>{m.mywork_col_scope()}</th>
					<th>{m.mywork_col_review_reason()}</th>
					<th>{m.mywork_col_sensitivity()}</th>
					<th>{m.mywork_col_est_review_time()}</th>
					<th>{m.mywork_col_waiting_time()}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.myWork.reviewing as item (item.pr.repoId + '/' + item.pr.prNumber)}
					<tr>
						<td>
							<a href={`/pr/${item.pr.repoId}/${item.pr.prNumber}`}>#{item.pr.prNumber}</a>
							{item.pr.title}
						</td>
						<td>{item.scope}</td>
						<td>{item.reviewReason}</td>
						<td>{item.sensitive ? m.common_yes() : m.common_no()}</td>
						<td>{m.common_minutes({ n: item.estimatedReviewMinutes })}</td>
						<td>{item.waitingSince}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<style>
	table {
		width: 100%;
		border-collapse: collapse;
		margin-bottom: 2rem;
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
</style>
