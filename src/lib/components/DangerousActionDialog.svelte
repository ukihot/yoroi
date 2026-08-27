<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import type { DangerousActionConfirmation } from '$lib/server/yoroi/types';

	let {
		open = $bindable(false),
		title,
		confirmation,
		onconfirm
	}: {
		open?: boolean;
		title: string;
		confirmation: DangerousActionConfirmation;
		onconfirm: (input: { reason: string; ticket: string }) => void;
	} = $props();

	let reason = $state('');
	let ticket = $state('');

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onconfirm({ reason, ticket });
		open = false;
		reason = '';
		ticket = '';
	}
</script>

{#if open}
	<div
		class="backdrop"
		role="button"
		tabindex="-1"
		aria-label={m.common_cancel()}
		onclick={() => (open = false)}
		onkeydown={(e) => e.key === 'Escape' && (open = false)}
	>
		<div
			class="panel"
			role="dialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<form onsubmit={submit}>
				<h2>{title}</h2>
				<dl>
					<dt>{m.action_confirm_what_changes()}</dt>
					<dd>{confirmation.whatChanges}</dd>
					<dt>{m.action_confirm_affected_scope()}</dt>
					<dd>{confirmation.affectedScope}</dd>
					<dt>{m.action_confirm_unsafe()}</dt>
					<dd>{confirmation.whatBecomesUnsafe}</dd>
					<dt>{m.action_confirm_expires_at()}</dt>
					<dd>{confirmation.expiresAt ?? m.action_confirm_no_expiry()}</dd>
					<dt>{m.action_confirm_additional_approvers()}</dt>
					<dd>{confirmation.additionalApproversRequired}</dd>
					<dt>{m.action_confirm_rollback()}</dt>
					<dd>{confirmation.rollbackProcedure}</dd>
				</dl>

				<label>
					{m.action_confirm_reason_label()}
					<input type="text" bind:value={reason} required />
				</label>
				<label>
					{m.action_confirm_ticket_label()}
					<input type="text" bind:value={ticket} required />
				</label>

				<div class="actions">
					<button type="button" onclick={() => (open = false)}>{m.common_cancel()}</button>
					<button type="submit" class="primary">{m.common_confirm()}</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgb(0 0 0 / 45%);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.panel {
		background: var(--yoroi-surface, #c0c0c0);
		color: inherit;
		border-radius: 0;
		box-shadow:
			var(--win-border-raised-outer, inset -1px -1px #0a0a0a, inset 1px 1px #fff),
			var(--win-border-raised-inner, inset -2px -2px #808080, inset 2px 2px #dfdfdf);
		padding: 1.25rem 1.5rem;
		width: min(32rem, 92vw);
		max-height: 85vh;
		overflow-y: auto;
	}
	h2 {
		margin-top: 0;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.35rem 0.75rem;
		margin: 0 0 1rem 0;
	}
	dt {
		font-weight: 600;
		color: var(--yoroi-muted, #6e7781);
	}
	dd {
		margin: 0;
	}
	label {
		display: block;
		font-size: 0.85rem;
		margin-bottom: 0.6rem;
	}
	input {
		display: block;
		width: 100%;
		margin-top: 0.2rem;
		padding: 0.4rem 0.5rem;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.75rem;
	}
	.primary {
		font-weight: bold;
		box-shadow:
			inset -2px -2px var(--win-window-frame, #0a0a0a),
			inset 1px 1px var(--win-window-frame, #0a0a0a),
			inset 2px 2px var(--win-button-highlight, #fff),
			inset -3px -3px var(--win-button-shadow, #808080),
			inset 3px 3px var(--win-button-face, #dfdfdf);
	}
	.primary:not(:disabled):active {
		box-shadow:
			inset 2px 2px var(--win-window-frame, #0a0a0a),
			inset -1px -1px var(--win-window-frame, #0a0a0a),
			inset -2px -2px var(--win-button-highlight, #fff),
			inset 3px 3px var(--win-button-shadow, #808080),
			inset -3px -3px var(--win-button-face, #dfdfdf);
	}
</style>
