<script lang="ts">
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import ReasonGraphView from '$lib/components/ReasonGraphView.svelte';
	import {
		checkConclusionLabel,
		checkConclusionTone,
		conclusionLabel,
		conclusionTone,
		gateName,
		gateStatusLabel,
		gateStatusTone,
		roleLabel
	} from '$lib/yoroi/labels';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();
	const detail = $derived(data.detail);
	const githubUrl = $derived(`https://github.com/${detail.pr.repo}/pull/${detail.pr.prNumber}`);
</script>

<svelte:head><title>{m.prdetail_title()} — {m.app_name()}</title></svelte:head>

<header>
	<h1>{m.prdetail_title()}</h1>
	<p>
		{m.prdetail_subtitle({ repo: detail.pr.repo, pr: String(detail.pr.prNumber) })} — {detail.pr
			.title}
	</p>
	<StatusBadge
		tone={conclusionTone(detail.conclusion)}
		label={conclusionLabel(detail.conclusion)}
	/>
</header>

<div class="actions">
	<form method="post" action="?/recheck" use:enhance>
		<button type="submit">{m.prdetail_action_recheck()}</button>
	</form>
	<a href={githubUrl} target="_blank" rel="noopener noreferrer">{m.prdetail_action_open_github()}</a
	>
</div>
{#if form?.recheck === 'unchanged'}
	<p class="hint">{m.prdetail_recheck_unchanged()}</p>
{:else if form?.recheck === 'changed'}
	<p class="hint">{m.prdetail_recheck_changed()}</p>
{:else if form?.recheck === 'pending'}
	<p class="hint">{m.prdetail_recheck_pending()}</p>
{/if}

<form method="post" action="?/feedback" use:enhance class="feedback">
	<label for="feedback-description">{m.prdetail_action_feedback()}</label>
	<textarea id="feedback-description" name="description" rows="2"></textarea>
	<button type="submit">{m.prdetail_feedback_submit()}</button>
</form>
{#if form?.feedback === 'submitted'}
	<p class="hint">{m.prdetail_feedback_submitted()}</p>
{:else if form?.feedback === 'missing'}
	<p class="hint error">{m.prdetail_feedback_missing()}</p>
{/if}

<section>
	<h2>{m.prdetail_section_gates()}</h2>
	<table>
		<thead>
			<tr>
				<th>{m.prdetail_col_gate()}</th>
				<th>{m.prdetail_col_status()}</th>
				<th>{m.prdetail_col_reason()}</th>
				<th>{m.prdetail_col_next_action()}</th>
				<th>{m.prdetail_col_waiting_on()}</th>
			</tr>
		</thead>
		<tbody>
			{#each detail.gates as row (row.gate)}
				<tr>
					<td>{gateName(row.gate)}</td>
					<td
						><StatusBadge
							tone={gateStatusTone(row.status)}
							label={gateStatusLabel(row.status)}
						/></td
					>
					<td>{row.reason}</td>
					<td>{row.nextAction}</td>
					<td>{row.waitingOn ?? m.common_none()}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<section>
	<h2>{m.prdetail_section_approvals()}</h2>
	<table>
		<thead>
			<tr>
				<th>{m.prdetail_col_scope()}</th>
				<th>{m.prdetail_col_required_role()}</th>
				<th>{m.prdetail_col_approver()}</th>
				<th>{m.prdetail_col_status()}</th>
			</tr>
		</thead>
		<tbody>
			{#each detail.approvals as row (row.scope)}
				<tr>
					<td>{row.scope}</td>
					<td>{roleLabel(row.requiredRole)}</td>
					<td>{row.approver ?? m.common_none()}</td>
					<td>
						<StatusBadge
							tone={row.maintained ? 'green' : 'amber'}
							label={row.maintained
								? m.prdetail_approval_maintained()
								: m.prdetail_approval_revoked()}
						/>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<section>
	<h2>{m.prdetail_section_ci()}</h2>
	<table>
		<thead>
			<tr>
				<th>{m.prdetail_col_job()}</th>
				<th>{m.prdetail_col_expected()}</th>
				<th>{m.prdetail_col_actual()}</th>
				<th>{m.prdetail_col_trusted_runner()}</th>
			</tr>
		</thead>
		<tbody>
			{#each detail.checks as row (row.job)}
				<tr>
					<td>{row.job}</td>
					<td>{row.expected ? m.check_expected_yes() : m.check_expected_no()}</td>
					<td>
						{#if row.conclusion}
							<StatusBadge
								tone={checkConclusionTone(row.conclusion)}
								label={checkConclusionLabel(row.conclusion)}
							/>
						{:else}
							{m.common_unknown()}
						{/if}
					</td>
					<td>{row.trustedRunner ? m.common_yes() : m.common_no()}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<section>
	<h2>{m.prdetail_section_reason_graph()}</h2>
	<ReasonGraphView node={detail.reasonGraph} />
</section>

<style>
	header {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		align-items: flex-start;
	}
	.actions {
		display: flex;
		gap: 1rem;
		align-items: center;
		margin: 0.75rem 0 1.25rem 0;
	}
	.hint {
		color: var(--yoroi-muted, #6e7781);
	}
	.hint.error {
		color: var(--yoroi-danger, #800000);
	}
	.feedback {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		align-items: flex-start;
		max-width: 32rem;
		margin-bottom: 1.25rem;
	}
	.feedback textarea {
		width: 100%;
		font: inherit;
	}
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
