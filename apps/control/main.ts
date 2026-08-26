import { createApp } from "./src/app.ts";
import { getControlContext } from "./src/context.ts";
import { drainOutbox } from "./src/worker/outbox.ts";
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
 */
if (typeof Deno.cron === "function") {
	Deno.cron("outbox-sweep", "* * * * *", async () => {
		await drainOutbox(getControlContext(), { budgetMs: 45_000 });
	});

	Deno.cron("github-reconcile", "*/5 * * * *", async () => {
		await sweepDeadLetterOutbox(getControlContext());
	});

	Deno.cron("approval-membership-scan", "*/15 * * * *", async () => {
		await scanApprovalMembership(getControlContext());
	});

	Deno.cron("evidence-completeness", "0 3 * * *", async () => {
		await checkEvidenceCompleteness(getControlContext());
	});

	Deno.cron("ttl-expiry", "* * * * *", async () => {
		await expireStaleLeases(getControlContext());
	});

	Deno.cron("dashboard-rollup", "*/1 * * * *", async () => {
		await refreshGithubApiHealth(getControlContext());
	});
}

Deno.serve({ port }, createApp());
