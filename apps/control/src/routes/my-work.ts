import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
	approval,
	blockedEntry,
	prDecisionSnapshot,
	prReviewerAssignment,
	prScopeRequirement,
	pullRequestRevision,
	repository,
} from "@yoroi/postgres";
import { json } from "../lib/http.ts";
import { formatRelativeJa } from "../lib/format.ts";
import { loadQueue } from "./queue.ts";
import type { RouteHandler } from "../app.ts";
import type {
	CheckConclusion,
	CheckRow,
	MyWork,
	MyWorkAuthoredItem,
	MyWorkReviewItem,
} from "../domain/types.ts";

function overallCheckConclusion(checks: CheckRow[]): CheckConclusion {
	if (checks.length === 0) return "pending";
	if (checks.some((c) => c.conclusion === "failure")) return "failure";
	if (checks.some((c) => c.conclusion === "pending" || c.conclusion === null)) return "pending";
	if (checks.every((c) => c.conclusion === "cancelled")) return "cancelled";
	return "success";
}

async function loadAuthored(actorStableId: string): Promise<MyWorkAuthoredItem[]> {
	const [rows, queue] = await Promise.all([
		db
			.select({
				repoId: pullRequestRevision.repoId,
				repoName: repository.name,
				prNumber: pullRequestRevision.prNumber,
				title: pullRequestRevision.title,
				state: pullRequestRevision.state,
				nextAction: pullRequestRevision.nextAction,
				revokedScopes: pullRequestRevision.revokedScopes,
				revokedScopesReason: pullRequestRevision.revokedScopesReason,
			})
			.from(pullRequestRevision)
			.innerJoin(repository, eq(repository.repoId, pullRequestRevision.repoId))
			.where(eq(pullRequestRevision.authorStableId, actorStableId)),
		loadQueue(),
	]);

	const queueByPr = new Map(queue.map((q) => [`${q.pr.repoId}/${q.pr.prNumber}`, q]));

	return Promise.all(
		rows.map(async (row) => {
			const queued = queueByPr.get(`${row.repoId}/${row.prNumber}`);

			const [requirements, approvals, snapshotRows, blocked] = await Promise.all([
				db
					.select()
					.from(prScopeRequirement)
					.where(
						and(
							eq(prScopeRequirement.repoId, row.repoId),
							eq(prScopeRequirement.prNumber, row.prNumber),
						),
					),
				db
					.select()
					.from(approval)
					.where(
						and(
							eq(approval.repoId, row.repoId),
							eq(approval.prNumber, row.prNumber),
							isNull(approval.revokedAt),
						),
					),
				db
					.select()
					.from(prDecisionSnapshot)
					.where(
						and(
							eq(prDecisionSnapshot.repoId, row.repoId),
							eq(prDecisionSnapshot.prNumber, row.prNumber),
						),
					)
					.limit(1),
				db
					.select()
					.from(blockedEntry)
					.where(and(eq(blockedEntry.repoId, row.repoId), eq(blockedEntry.prNumber, row.prNumber)))
					.limit(1),
			]);

			const approvedScopeIds = new Set(approvals.map((a) => a.scopeId));
			const maintainedScopes = approvals.filter((a) => a.maintained).map((a) => a.scopeId);
			const checks = (snapshotRows[0]?.checks ?? []) as CheckRow[];

			return {
				pr: { repoId: row.repoId, repo: row.repoName, prNumber: row.prNumber, title: row.title },
				stage: row.state,
				approvalsApproved: approvedScopeIds.size,
				approvalsRequired: requirements.length,
				ci: overallCheckConclusion(checks),
				queuePosition: queued?.position ?? null,
				eta: queued?.eta ?? null,
				blockingReason: blocked[0]?.reason ?? null,
				nextAction: row.nextAction,
				maintainedScopes,
				revokedScopes: row.revokedScopes && row.revokedScopes.length > 0
					? { scopes: row.revokedScopes, reason: row.revokedScopesReason ?? "" }
					: null,
			} satisfies MyWorkAuthoredItem;
		}),
	);
}

async function loadReviewing(actorStableId: string): Promise<MyWorkReviewItem[]> {
	const rows = await db
		.select({
			repoId: prReviewerAssignment.repoId,
			repoName: repository.name,
			prNumber: prReviewerAssignment.prNumber,
			title: pullRequestRevision.title,
			scopeId: prReviewerAssignment.scopeId,
			reason: prReviewerAssignment.reason,
			sensitive: prReviewerAssignment.sensitive,
			estimatedReviewMinutes: prReviewerAssignment.estimatedReviewMinutes,
			waitingSince: prReviewerAssignment.waitingSince,
		})
		.from(prReviewerAssignment)
		.innerJoin(repository, eq(repository.repoId, prReviewerAssignment.repoId))
		.leftJoin(
			pullRequestRevision,
			and(
				eq(pullRequestRevision.repoId, prReviewerAssignment.repoId),
				eq(pullRequestRevision.prNumber, prReviewerAssignment.prNumber),
			),
		)
		.where(eq(prReviewerAssignment.actorStableId, actorStableId));

	return rows.map((r) => ({
		pr: { repoId: r.repoId, repo: r.repoName, prNumber: r.prNumber, title: r.title ?? "" },
		scope: r.scopeId,
		reviewReason: r.reason,
		sensitive: r.sensitive,
		estimatedReviewMinutes: r.estimatedReviewMinutes,
		waitingSince: formatRelativeJa(r.waitingSince),
	}));
}

export const handleMyWork: RouteHandler = async (_req, actor) => {
	const [authored, reviewing] = await Promise.all([
		loadAuthored(actor.actorStableId),
		loadReviewing(actor.actorStableId),
	]);
	const myWork: MyWork = { authored, reviewing };
	return json(myWork);
};
