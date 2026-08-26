import { claimOutboxBatch, markOutboxDone, markOutboxFailed } from "@yoroi/postgres";
import type { OutboxWork } from "@yoroi/postgres";
import type { ControlContext } from "../context.ts";
import { evaluatePr } from "./evaluate-pr.ts";
import { runSerialCycle } from "./serial-scheduler.ts";
import { dispatchSlashCommand } from "./slash-commands.ts";

export interface DrainOutboxOptions {
	readonly budgetMs: number;
	readonly limit?: number;
}

export type WorkHandler = (ctx: ControlContext, work: OutboxWork) => Promise<void>;

/** design.md §7.1 routeEventToWorkKind's counterpart: dispatch by `kind`. */
export const HANDLERS: Readonly<Record<string, WorkHandler>> = {
	evaluate_policy: async (ctx, work) => {
		await evaluatePr(ctx, work);
		// §11.1: 評価直後にrepoのSerial cycleを1回進める(queueに変化があれば候補構築へ)
		await runSerialCycle(ctx, work);
	},
	ingest_check_result: async (ctx, work) => {
		await evaluatePr(ctx, work);
	},
	handle_slash_command: async (ctx, work) => {
		await dispatchSlashCommand(ctx, work);
	},
	dispatch_merge: async (ctx, work) => {
		await runSerialCycle(ctx, work);
	},
	// installation/push/etc: no immediate per-event action for MVP — the
	// github-reconcile Cron (design.md §17.2) is the safety net for these.
	reconcile_hint: () => Promise.resolve(),
};

/**
 * design.md §7.3/§7.1's bounded drain: claim a small batch, process each
 * within `budgetMs` of wall-clock time, then stop — never an unbounded loop
 * that could blow the webhook response's 10s budget (§7.4's checklist: no
 * detached-Promise-only continuation on the primary delivery path, but this
 * bounded, `await`ed drain is not that — it's the documented in-request
 * processing step itself).
 */
export async function drainOutbox(ctx: ControlContext, opts: DrainOutboxOptions): Promise<number> {
	const deadline = Date.now() + opts.budgetMs;
	let processed = 0;

	while (Date.now() < deadline) {
		const batch = await claimOutboxBatch(ctx.db, ctx.instanceId, opts.limit ?? 20);
		if (batch.length === 0) break;

		for (const work of batch) {
			if (Date.now() >= deadline) break;
			try {
				const handler = HANDLERS[work.kind];
				if (!handler) throw new Error(`no handler registered for outbox kind "${work.kind}"`);
				await handler(ctx, work);
				await markOutboxDone(ctx.db, work.id);
			} catch (error) {
				await markOutboxFailed(
					ctx.db,
					work,
					error instanceof Error ? error.message : String(error),
				);
			}
			processed++;
		}
	}

	return processed;
}
