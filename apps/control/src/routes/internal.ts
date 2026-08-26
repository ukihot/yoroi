import { getControlContext } from "../context.ts";
import { drainOutbox } from "../worker/outbox.ts";
import { sweepDeadLetterOutbox } from "../worker/cron-jobs.ts";
import { badRequest, json } from "../lib/http.ts";
import type { RouteHandler } from "../app.ts";

/** design.md §16: `POST /internal/outbox/drain` — the same bounded-drain
 * function the webhook route calls inline, reachable directly for Cron
 * (`outbox-sweep`, design.md §17.2) or manual operator triggering. */
export const handleOutboxDrain: RouteHandler = async (req) => {
	let body: { budgetMs?: unknown } = {};
	try {
		body = await req.json();
	} catch {
		// no body / not JSON — use the default budget
	}
	const budgetMs = typeof body.budgetMs === "number" ? body.budgetMs : 20_000;
	if (budgetMs <= 0 || budgetMs > 60_000) return badRequest("budgetMs must be between 1 and 60000");

	const ctx = getControlContext();
	const processed = await drainOutbox(ctx, { budgetMs });
	return json({ processed });
};

/**
 * design.md §16/§17.2's `github-reconcile` Cron target, also reachable
 * manually. MVP scope: revives `work_outbox` items stuck in `dead` state
 * (past `max_attempt`) back to `pending` for another attempt. The fuller
 * "re-fetch every open PR/Ruleset from GitHub and diff against stored
 * state" reconcile design.md §7/§13.6 also describes needs a GitHub App
 * list-installations/list-repos capability `GitHubAdapter` doesn't expose
 * yet — tracked as follow-up work, not silently skipped.
 */
export const handleReconcile: RouteHandler = async () => {
	const ctx = getControlContext();
	const revivedDeadOutboxItems = await sweepDeadLetterOutbox(ctx);
	return json({ revivedDeadOutboxItems });
};
