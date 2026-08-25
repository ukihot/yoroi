import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
	approval,
	decisionEvent,
	feedbackCase,
	prDecisionSnapshot,
	prScopeRequirement,
	pullRequestRevision,
	repository,
} from "../db/schema.ts";
import { badRequest, json, notFound } from "../lib/http.ts";
import type { RouteHandler } from "../app.ts";
import type {
	ApprovalRow,
	FeedbackCase,
	PrDecisionDetail,
	RecheckOutcome,
} from "../domain/types.ts";

async function loadApprovals(repoId: string, prNumber: number): Promise<ApprovalRow[]> {
	const [requirements, approvals] = await Promise.all([
		db
			.select()
			.from(prScopeRequirement)
			.where(and(eq(prScopeRequirement.repoId, repoId), eq(prScopeRequirement.prNumber, prNumber))),
		db
			.select()
			.from(approval)
			.where(
				and(
					eq(approval.repoId, repoId),
					eq(approval.prNumber, prNumber),
					isNull(approval.revokedAt),
				),
			),
	]);
	const byScope = new Map(approvals.map((a) => [a.scopeId, a]));
	return requirements.map((req) => {
		const matched = byScope.get(req.scopeId);
		return {
			scope: req.scopeId,
			requiredRole: req.requiredRole,
			approver: matched?.actorStableId ?? null,
			maintained: matched?.maintained ?? false,
		};
	});
}

async function loadPrDetail(repoId: string, prNumber: number): Promise<PrDecisionDetail | null> {
	const [prRow] = await db
		.select({ title: pullRequestRevision.title, repoName: repository.name })
		.from(pullRequestRevision)
		.innerJoin(repository, eq(repository.repoId, pullRequestRevision.repoId))
		.where(and(eq(pullRequestRevision.repoId, repoId), eq(pullRequestRevision.prNumber, prNumber)))
		.limit(1);
	if (!prRow) return null;

	const [snapshot] = await db
		.select()
		.from(prDecisionSnapshot)
		.where(and(eq(prDecisionSnapshot.repoId, repoId), eq(prDecisionSnapshot.prNumber, prNumber)))
		.limit(1);

	const approvals = await loadApprovals(repoId, prNumber);

	return {
		pr: { repoId, repo: prRow.repoName, prNumber, title: prRow.title },
		conclusion: snapshot?.conclusion ?? { kind: "waiting_ci" },
		gates: snapshot?.gates ?? [],
		approvals,
		checks: snapshot?.checks ?? [],
		reasonGraph: snapshot?.reasonGraph ?? { label: "判定待ち", children: [] },
	};
}

function parsePrParams(
	params: Record<string, string>,
): { repoId: string; prNumber: number } | null {
	const prNumber = Number(params.prNumber);
	if (!params.repoId || Number.isNaN(prNumber)) return null;
	return { repoId: params.repoId, prNumber };
}

export const handlePrDetail: RouteHandler = async (_req, _actor, params) => {
	const parsed = parsePrParams(params);
	if (!parsed) return badRequest("repoId and a numeric prNumber are required");
	const detail = await loadPrDetail(parsed.repoId, parsed.prNumber);
	if (!detail) return notFound(`PR ${parsed.repoId}#${parsed.prNumber}`);
	return json(detail);
};

const RECHECK_COOLDOWN_MS = 60_000;

/**
 * design.md §15.2's recheck coalescing: a repeat call within 60s for the
 * same PR short-circuits to 'pending' instead of re-running. There is no
 * real GitHub refetch / Policy Engine evaluation to run yet (see
 * db/schema.ts's notes on pr_decision_snapshot) — this re-reads the stored
 * snapshot and reports whether it changed since last read, which today
 * means 'unchanged' unless no snapshot exists yet for this PR. A
 * `decision_event` row is always appended so the audit trail reflects that
 * a recheck happened, even when nothing changed.
 */
export const handleRecheck: RouteHandler = async (_req, actor, params) => {
	const parsed = parsePrParams(params);
	if (!parsed) return badRequest("repoId and a numeric prNumber are required");
	const { repoId, prNumber } = parsed;

	const detail = await loadPrDetail(repoId, prNumber);
	if (!detail) return notFound(`PR ${repoId}#${prNumber}`);

	const cooldownSince = new Date(Date.now() - RECHECK_COOLDOWN_MS);
	const [recent] = await db
		.select()
		.from(decisionEvent)
		.where(
			and(
				eq(decisionEvent.repoId, repoId),
				eq(decisionEvent.prNumber, prNumber),
				eq(decisionEvent.operation, "recheck"),
				gt(decisionEvent.occurredAt, cooldownSince),
			),
		)
		.orderBy(desc(decisionEvent.occurredAt))
		.limit(1);

	let outcome: RecheckOutcome;
	if (recent) {
		outcome = "pending";
	} else {
		const [snapshot] = await db
			.select()
			.from(prDecisionSnapshot)
			.where(and(eq(prDecisionSnapshot.repoId, repoId), eq(prDecisionSnapshot.prNumber, prNumber)))
			.limit(1);
		outcome = snapshot ? "unchanged" : "changed";
	}

	await db.insert(decisionEvent).values({
		repoId,
		prNumber,
		actorStableId: actor.actorStableId,
		operation: "recheck",
		reasonCode: "manual_recheck",
		result: outcome,
	});

	return json({ outcome } satisfies { outcome: RecheckOutcome });
};

export const handleFeedback: RouteHandler = async (req, actor, params) => {
	const parsed = parsePrParams(params);
	if (!parsed) return badRequest("repoId and a numeric prNumber are required");
	const { repoId, prNumber } = parsed;

	let body: { description?: unknown };
	try {
		body = await req.json();
	} catch {
		return badRequest("request body must be JSON");
	}
	const description = typeof body.description === "string" ? body.description.trim() : "";
	if (!description) return badRequest("description is required");

	// category is fixed for MVP (no console-side category picker yet) — see
	// plan notes. design.md §6.7's feedback_case.category is a free-text
	// column, so widening this later is a column-value change only.
	const [row] = await db
		.insert(feedbackCase)
		.values({
			repoId,
			prNumber,
			category: "console",
			actorStableId: actor.actorStableId,
			description,
		})
		.returning();
	if (!row) throw new Error("feedback_case insert returned no row");

	await db.insert(decisionEvent).values({
		repoId,
		prNumber,
		actorStableId: actor.actorStableId,
		operation: "feedback",
		reasonCode: "console_feedback",
		result: "recorded",
	});

	const feedback: FeedbackCase = {
		id: row.id,
		repoId: row.repoId,
		prNumber: row.prNumber,
		category: row.category,
		actorStableId: row.actorStableId,
		description: row.description,
		createdAt: row.createdAt.toISOString(),
	};
	return json(feedback, { status: 201 });
};
