import { getEnv } from "./env.ts";

/**
 * Deno Deploy free-tier CPU-time cost-tuning knobs (see root README's
 * "運用・保守メモ" troubleshooting entry for the incident that prompted
 * this). These are cadence/budget values with no correctness or security
 * semantics of their own — every job here is a §7.4/DP-08 "reconcile, do
 * not assume" safety net, not the primary path, so running it less often
 * only delays reconciliation, it never produces a wrong result. That makes
 * them safe to expose as env-var overrides (settable per Deno Deploy
 * context from the dashboard, no code change/redeploy needed) instead of
 * literals buried in main.ts.
 *
 * Deliberately NOT here: anything with correctness/security meaning
 * (Decision Envelope TTL in worker/serial-scheduler.ts, the recheck
 * cooldown in routes/pr.ts, the webhook inbox retention window and the
 * webhook route's own inline drain budget — the latter is bounded by
 * GitHub's hard 10s webhook timeout). Those stay literals on purpose: a
 * mistyped env var should not be able to silently widen a security window
 * or blow past GitHub's timeout.
 */
export const CRON_SCHEDULE = {
	/** design.md §17.2's outbox-sweep + ttl-expiry, merged into one
	 * `Deno.cron` registration (both are DB-only, no external network/crypto
	 * cost — merging just halves the per-minute cold-start count). */
	outboxSweepAndTtlExpiry: getEnv("YOROI_CRON_OUTBOX_SWEEP_AND_TTL_EXPIRY", "* * * * *"),
	/** design.md §17.2's dead-letter outbox sweep. */
	githubReconcile: getEnv("YOROI_CRON_GITHUB_RECONCILE", "*/5 * * * *"),
	/** Currently a no-op placeholder (see worker/cron-jobs.ts) — no reason to
	 * wake it often until it has real work to do. */
	approvalMembershipScan: getEnv("YOROI_CRON_APPROVAL_MEMBERSHIP_SCAN", "0 * * * *"),
	/** design.md §17.2's daily evidence-completeness audit. */
	evidenceCompleteness: getEnv("YOROI_CRON_EVIDENCE_COMPLETENESS", "0 3 * * *"),
	/** The one job that makes a real GitHub API call and JWT-signs an
	 * installation token — the most CPU-heavy of the six, so it gets the
	 * least frequent schedule. It only refreshes a dashboard health gauge,
	 * which doesn't need per-minute freshness. */
	dashboardRollup: getEnv("YOROI_CRON_DASHBOARD_ROLLUP", "*/15 * * * *"),
} as const;

/** Wall-clock cap for the minutely outbox-sweep-and-ttl-expiry tick's
 * `drainOutbox` call. A soft worst-case ceiling, not a correctness bound —
 * `drainOutbox` already returns immediately once the outbox is empty. */
export const OUTBOX_SWEEP_BUDGET_MS = Number(getEnv("YOROI_CRON_OUTBOX_SWEEP_BUDGET_MS", "20000"));
