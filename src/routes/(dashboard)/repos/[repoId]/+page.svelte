<script lang="ts">
	import { applyAction, deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import DangerousActionDialog from '$lib/components/DangerousActionDialog.svelte';
	import { queueModeLabel, repoStatusLabel } from '$lib/yoroi/labels';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();
	const repo = $derived(data.repo);

	let pauseOpen = $state(false);
	let drainOpen = $state(false);

	async function submitAction(
		action: 'pause' | 'drain',
		input: { reason: string; ticket: string }
	) {
		const body = new FormData();
		body.set('reason', input.reason);
		body.set('ticket', input.ticket);
		const response = await fetch(`?/${action}`, { method: 'POST', body });
		const result = deserialize(await response.text());
		if (result.type === 'success') await invalidateAll();
		applyAction(result);
	}

	const metrics = $derived([
		{ label: m.repodetail_metric_lead_time(), ...repo.metrics.leadTime },
		{ label: m.repodetail_metric_review_wait(), ...repo.metrics.reviewWait },
		{ label: m.repodetail_metric_ci_duration(), ...repo.metrics.ciDuration },
		{ label: m.repodetail_metric_queue_wait(), ...repo.metrics.queueWait },
		{ label: m.repodetail_metric_internal_time(), ...repo.metrics.internalTime }
	]);

	const rates = $derived([
		{ label: m.repodetail_metric_gate_pass_rate(), value: repo.gatePassRatePct },
		{ label: m.repodetail_metric_ci_success_rate(), value: repo.ciSuccessRatePct },
		{ label: m.repodetail_metric_flaky_rate(), value: repo.flakyRatePct },
		{ label: m.repodetail_metric_rebuild_rate(), value: repo.rebuildRatePct },
		{ label: m.repodetail_metric_batch_split_rate(), value: repo.batchSplitRatePct },
		{ label: m.repodetail_metric_auto_revert_rate(), value: repo.autoRevertRatePct }
	]);

	const pauseConfirmation = $derived({
		whatChanges: m.repodetail_pause_what_changes({ repo: repo.name }),
		affectedScope: repo.name,
		whatBecomesUnsafe: m.repodetail_pause_unsafe(),
		expiresAt: null,
		additionalApproversRequired: 0,
		rollbackProcedure: m.repodetail_pause_rollback()
	});
	const drainConfirmation = $derived({
		whatChanges: m.repodetail_drain_what_changes({ repo: repo.name }),
		affectedScope: repo.name,
		whatBecomesUnsafe: m.repodetail_drain_unsafe(),
		expiresAt: null,
		additionalApproversRequired: 0,
		rollbackProcedure: m.repodetail_drain_rollback()
	});
</script>

<svelte:head><title>{m.repodetail_title({ repo: repo.name })} — {m.app_name()}</title></svelte:head>

<p><a href="/repos">← {m.repodetail_back_to_list()}</a></p>

<header>
	<h1>{repo.name}</h1>
	<div class="actions">
		<button type="button" onclick={() => (pauseOpen = true)}>{m.repodetail_action_pause()}</button>
		<button type="button" onclick={() => (drainOpen = true)}>{m.repodetail_action_drain()}</button>
	</div>
	{#if form?.action === 'pause'}
		<p class="hint">{form.ok ? m.repodetail_pause_done() : m.repodetail_action_invalid()}</p>
	{:else if form?.action === 'drain'}
		<p class="hint">{form.ok ? m.repodetail_drain_done() : m.repodetail_action_invalid()}</p>
	{/if}
</header>

<DangerousActionDialog
	bind:open={pauseOpen}
	title={m.repodetail_action_pause()}
	confirmation={pauseConfirmation}
	onconfirm={(input) => submitAction('pause', input)}
/>
<DangerousActionDialog
	bind:open={drainOpen}
	title={m.repodetail_action_drain()}
	confirmation={drainConfirmation}
	onconfirm={(input) => submitAction('drain', input)}
/>

<section>
	<h2>{m.repodetail_section_current_state()}</h2>
	<dl>
		<dt>{m.repodetail_field_mode()}</dt>
		<dd>{queueModeLabel(repo.mode)}</dd>
		<dt>{m.repos_col_status()}</dt>
		<dd>
			<StatusBadge
				tone={repo.status === 'active' ? 'green' : repo.status === 'paused' ? 'amber' : 'neutral'}
				label={repoStatusLabel(repo.status)}
			/>
		</dd>
		<dt>{m.repodetail_field_target_branch()}</dt>
		<dd>{repo.targetBranch}</dd>
		<dt>{m.repodetail_field_policy_version()}</dt>
		<dd>{repo.policyVersion}</dd>
		<dt>{m.repodetail_field_ruleset()}</dt>
		<dd>
			{repo.rulesetConsistent ? m.repodetail_ruleset_consistent() : m.repodetail_ruleset_drifted()}
		</dd>
		<dt>{m.repodetail_field_installation()}</dt>
		<dd>{repo.installationOk ? m.common_yes() : m.common_no()}</dd>
		<dt>{m.repodetail_field_last_webhook()}</dt>
		<dd>{repo.lastWebhookAt}</dd>
		<dt>{m.repodetail_field_last_reconcile()}</dt>
		<dd>{repo.lastReconcileAt}</dd>
	</dl>
</section>

<section>
	<h2>{m.repodetail_section_health()}</h2>
	<table>
		<thead>
			<tr>
				<th>{m.repodetail_col_metric()}</th>
				<th>{m.repodetail_col_p50()}</th>
				<th>{m.repodetail_col_p95()}</th>
			</tr>
		</thead>
		<tbody>
			{#each metrics as row (row.label)}
				<tr>
					<td>{row.label}</td>
					<td>{m.common_minutes({ n: row.p50 })}</td>
					<td>{m.common_minutes({ n: row.p95 })}</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<table>
		<tbody>
			{#each rates as row (row.label)}
				<tr>
					<td>{row.label}</td>
					<td>{m.common_percent({ n: row.value })}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<style>
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.3rem 1rem;
	}
	dt {
		color: var(--yoroi-muted, #6e7781);
	}
	dd {
		margin: 0;
	}
	table {
		border-collapse: collapse;
		margin: 0.5rem 0 1.5rem 0;
	}
	th,
	td {
		text-align: left;
		padding: 0.4rem 0.8rem 0.4rem 0;
	}
</style>
