import { db } from "../db/client.ts";
import { approval, approvalCarryForward, prReviewerAssignment } from "@yoroi/postgres";
import { json } from "../lib/http.ts";
import { minutesSince } from "../lib/format.ts";
import type { RouteHandler } from "../app.ts";
import type { ReviewerLoad, ReviewerLoadSummary, ScopeLoad } from "../domain/types.ts";

/**
 * design.md §23.10 Reviews screen: "ownership設計のボトルネックを発見する画面"
 * ("a screen for finding ownership-design bottlenecks", not for judging
 * people). Built entirely from tables the live pipeline already writes —
 * `pr_reviewer_assignment` (same rows My Work's "reviewing" list already
 * uses) and `approval_carry_forward` (written by
 * worker/approval-continuity.ts). Two design.md bullets have no real data
 * source anywhere in this codebase and are deliberately left out rather than
 * faked: "自動再依頼回数 (FR-102重複依頼率)" (no dedicated re-request
 * tracking exists) and "不在・休暇によるcoverage不足" (no leave/absence
 * calendar integration exists) — the console screen notes this gap plainly
 * instead of hiding it.
 */
export async function loadReviewerLoad(): Promise<ReviewerLoadSummary> {
	const [assignments, carryForwardCount, approvalCount] = await Promise.all([
		db
			.select({
				scopeId: prReviewerAssignment.scopeId,
				actorStableId: prReviewerAssignment.actorStableId,
				sensitive: prReviewerAssignment.sensitive,
				waitingSince: prReviewerAssignment.waitingSince,
			})
			.from(prReviewerAssignment),
		db.$count(approvalCarryForward),
		db.$count(approval),
	]);

	const byScopeMap = new Map<string, { pendingCount: number; reviewers: Set<string> }>();
	const byReviewerMap = new Map<
		string,
		{ pendingCount: number; sensitiveCount: number; oldestWaitingMinutes: number }
	>();

	for (const row of assignments) {
		const scope = byScopeMap.get(row.scopeId) ?? { pendingCount: 0, reviewers: new Set<string>() };
		scope.pendingCount += 1;
		scope.reviewers.add(row.actorStableId);
		byScopeMap.set(row.scopeId, scope);

		const waited = minutesSince(row.waitingSince);
		const reviewer = byReviewerMap.get(row.actorStableId) ??
			{ pendingCount: 0, sensitiveCount: 0, oldestWaitingMinutes: 0 };
		reviewer.pendingCount += 1;
		if (row.sensitive) reviewer.sensitiveCount += 1;
		reviewer.oldestWaitingMinutes = Math.max(reviewer.oldestWaitingMinutes, waited);
		byReviewerMap.set(row.actorStableId, reviewer);
	}

	const byScope: ScopeLoad[] = [...byScopeMap.entries()]
		.map(([scope, v]) => ({
			scope,
			pendingCount: v.pendingCount,
			reviewerCount: v.reviewers.size,
			hasBackupReviewer: v.reviewers.size > 1,
		}))
		.sort((a, b) => b.pendingCount - a.pendingCount);

	const byReviewer: ReviewerLoad[] = [...byReviewerMap.entries()]
		.map(([actor, v]) => ({ actor, ...v }))
		.sort((a, b) => b.pendingCount - a.pendingCount);

	const totalPending = assignments.length;
	const concentrationPct = totalPending > 0 && byReviewer.length > 0
		? Math.round((byReviewer[0]!.pendingCount / totalPending) * 100)
		: 0;
	// "承認continuityの判断のうち何%が再承認を避けられたか" — see design.md §4.3.
	const carryForwardDecisions = carryForwardCount + approvalCount;
	const carryForwardRatePct = carryForwardDecisions > 0
		? Math.round((carryForwardCount / carryForwardDecisions) * 100)
		: 0;

	return { byScope, byReviewer, totalPending, concentrationPct, carryForwardRatePct };
}

export const handleReviewerLoad: RouteHandler = async () => {
	return json(await loadReviewerLoad());
};
