import { createApp } from "./src/app.ts";
import { getControlContext } from "./src/context.ts";
import { drainOutbox } from "./src/worker/outbox.ts";
import { CRON_SCHEDULE, OUTBOX_SWEEP_BUDGET_MS } from "./src/config.ts";
import {
	checkEvidenceCompleteness,
	expireStaleLeases,
	refreshGithubApiHealth,
	scanApprovalMembership,
	sweepDeadLetterOutbox,
} from "./src/worker/cron-jobs.ts";

const port = Number(Deno.env.get("PORT") ?? "8787");

/**
 * design.md §17.2's 6 Cron jobs — a safety net (§7.4/DP-08 "reconcile, do
 * not assume"), not the primary low-latency path (that's the webhook
 * route's own inline bounded drain). `typeof Deno.cron === "function"`
 * guards registration: outside the Deno Deploy runtime (local
 * `deno task dev`, `deno task test`) `Deno.cron` doesn't exist, and this app
 * must still boot without it.
 *
 * CPU-time cost note (learned from an actual free-plan usage warning after a
 * few hours live): Deno Deploy's free-tier CPU-time budget is spent mostly
 * on isolate cold starts and CPU-bound work (module evaluation, JSON,
 * crypto/JWT signing) — I/O *wait* (DB round-trips, HTTP) doesn't count
 * (https://docs.deno.com/deploy/pricing_and_limits/). Every separate
 * `Deno.cron` registration is a separate wake-up opportunity, so the
 * schedules themselves (and this tick's outbox budget) live in
 * `src/config.ts` as env-overridable operational knobs rather than literals
 * here — see that file's comment for which values are (and deliberately
 * aren't) safe to tune that way, and the root README's troubleshooting
 * entry for the incident this responds to. As registered below:
 *  - the two cheapest, DB-only, no-external-call jobs (`outbox-sweep`,
 *    `ttl-expiry`) are merged into one minutely tick instead of two, halving
 *    that cadence's wake-up count.
 *  - `dashboard-rollup` is the one job that makes a real GitHub API call
 *    (JWT-signs an installation token every time) — it doesn't need
 *    per-minute freshness for a dashboard health gauge, so it defaults to
 *    every 15 minutes (15x fewer cold starts for the most CPU-heavy job).
 *  - `approval-membership-scan` is still an unimplemented no-op (see
 *    cron-jobs.ts) — no reason to wake it often to do nothing; hourly is
 *    plenty until it has real work to do.
 */
if (typeof Deno.cron === "function") {
	Deno.cron("outbox-sweep-and-ttl-expiry", CRON_SCHEDULE.outboxSweepAndTtlExpiry, async () => {
		const ctx = getControlContext();
		await drainOutbox(ctx, { budgetMs: OUTBOX_SWEEP_BUDGET_MS });
		await expireStaleLeases(ctx);
	});

	Deno.cron("github-reconcile", CRON_SCHEDULE.githubReconcile, async () => {
		await sweepDeadLetterOutbox(getControlContext());
	});

	Deno.cron("approval-membership-scan", CRON_SCHEDULE.approvalMembershipScan, async () => {
		await scanApprovalMembership(getControlContext());
	});

	Deno.cron("evidence-completeness", CRON_SCHEDULE.evidenceCompleteness, async () => {
		await checkEvidenceCompleteness(getControlContext());
	});

	Deno.cron("dashboard-rollup", CRON_SCHEDULE.dashboardRollup, async () => {
		await refreshGithubApiHealth(getControlContext());
	});
}

Deno.serve({ port }, createApp());
