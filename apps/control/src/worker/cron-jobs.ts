import { eq } from "drizzle-orm";
import {
	clearExpiredLeaseHolders,
	fleetHealthSnapshot,
	loadDecisionEventChain,
	repository,
	workOutbox,
} from "@yoroi/postgres";
import { verifyChain } from "@yoroi/evidence";
import type { ControlContext } from "../context.ts";

/**
 * design.md §17.2's 6 Cron jobs. `outbox-sweep`/`ttl-expiry`/`dashboard-rollup`
 * are exercised for real here; `github-reconcile` covers this pass's scoped
 * subset (dead-letter outbox revival — see its own comment); `approval-
 * membership-scan` is a documented no-op (see below) rather than silently
 * unregistered, since design.md §17.2 lists it as one of exactly 6 jobs.
 */

export async function sweepDeadLetterOutbox(ctx: ControlContext): Promise<number> {
	const revived = await ctx.db
		.update(workOutbox)
		.set({ state: "pending", attempt: 0, availableAt: new Date() })
		.where(eq(workOutbox.state, "dead"))
		.returning({ id: workOutbox.id });
	return revived.length;
}

export async function expireStaleLeases(ctx: ControlContext): Promise<number> {
	return await clearExpiredLeaseHolders(ctx.db);
}

/** design.md §17.2/§6.7/AT-19: re-walks each repo's decision_event hash
 * chain and logs (doesn't silently swallow) any break. No external
 * `EvidenceSink` is wired in this pass (see packages/evidence/src/export.ts's
 * comment) — this Cron's job is detection, not export, until one exists. */
export async function checkEvidenceCompleteness(
	ctx: ControlContext,
): Promise<{ repoId: string; broken: boolean }[]> {
	const repos = await ctx.db.select({ repoId: repository.repoId }).from(repository);
	const results: { repoId: string; broken: boolean }[] = [];
	for (const { repoId } of repos) {
		const chain = await loadDecisionEventChain(ctx.db, repoId);
		if (chain.length === 0) continue;
		const verification = await verifyChain(chain);
		if (!verification.ok) {
			console.error(
				`[yoroi-control] evidence-completeness: decision_event chain broken for ${repoId} at index ${verification.brokenAtIndex} (${verification.reason})`,
			);
		}
		results.push({ repoId, broken: !verification.ok });
	}
	return results;
}

/** design.md §24.7: refreshes the `github_api` component of
 * `fleet_health_snapshot` from the adapter's rate-limit status. Other
 * components (`control`/`merger`/`console`/`evidence_export`) need signals
 * this pass doesn't yet produce (instance health, merger uptime, export
 * lag) — left at whatever `seed.ts`/a prior run set, not fabricated here. */
export async function refreshGithubApiHealth(ctx: ControlContext): Promise<void> {
	const status = await ctx.github.getRateLimitStatus();
	const health: "green" | "amber" | "red" = status.remainingPct < 5
		? "red"
		: status.remainingPct < 20
		? "amber"
		: "green";
	const repos = await ctx.db.select({ installationId: repository.installationId }).from(repository);
	const installationIds = [...new Set(repos.map((r) => r.installationId))];
	for (const installationId of installationIds) {
		await ctx.db
			.insert(fleetHealthSnapshot)
			.values({
				installationId,
				component: "github_api",
				status: health,
				metric: { rate_limit_remaining_pct: status.remainingPct },
				reason: `rate limit remaining ${status.remainingPct}%`,
			})
			.onConflictDoUpdate({
				target: [fleetHealthSnapshot.installationId, fleetHealthSnapshot.component],
				set: {
					status: health,
					metric: { rate_limit_remaining_pct: status.remainingPct },
					reason: `rate limit remaining ${status.remainingPct}%`,
					observedAt: new Date(),
				},
			});
	}
}

/**
 * design.md §17.2's `approval-membership-scan`: re-verify approvers are
 * still team/org members, invalidating approvals from members who've since
 * left (FR-026). `GitHubAdapter` has no team/org-membership listing method
 * yet (only PR/tree/check/comment/merge operations, §13.1) — implementing
 * this for real needs that adapter surface first. Registered as a
 * documented no-op rather than silently omitted, since design.md §17.2
 * names it as one of exactly 6 scheduled jobs.
 */
export function scanApprovalMembership(_ctx: ControlContext): Promise<void> {
	console.warn(
		"[yoroi-control] approval-membership-scan: not implemented — GitHubAdapter has no team/org membership listing yet (see cron-jobs.ts)",
	);
	return Promise.resolve();
}
