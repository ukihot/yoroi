import { and, eq } from "drizzle-orm";
import type { OutboxWork } from "@yoroi/postgres";
import {
	blockedEntry,
	notificationAnchor,
	policyBundle,
	prDecisionSnapshot,
	prScopeRequirement,
	pullRequestRevision,
	repository,
} from "@yoroi/postgres";
import { approval as approvalTable } from "@yoroi/postgres";
import type { RepoRef } from "@yoroi/github";
import {
	actorStableId as toActorStableId,
	generateOperationId,
	installationId as toInstallationId,
	type PrState,
	type PrStateRow,
	pullRequestNumber as toPullRequestNumber,
	reduce,
	repositoryId as toRepositoryId,
	type ScopeId,
	sha as toSha,
	sha256HexOf,
	type StateEvent,
} from "@yoroi/domain";
import { compilePolicy, evaluate, scopesForTouchedPaths } from "@yoroi/policy";
import type {
	ApprovalFact,
	CheckFact,
	CompiledPolicy,
	EvaluationInput,
	ReasonGraphNode,
} from "@yoroi/policy";
import { classifyResponsibility, upsertSummary } from "@yoroi/notifications";
import type { NotificationAnchorState, SummaryState } from "@yoroi/notifications";
import { withSpan } from "@yoroi/observability";
import type { ControlContext } from "../context.ts";
import { parseEventFacts } from "./event-facts.ts";
import { DEFAULT_POLICY } from "./default-policy.ts";
import { reconfirmApprovalsOnSynchronize } from "./approval-continuity.ts";
import { approverRoleToDashboardRole, dashboardRoleToApproverRole } from "./role-mapping.ts";

/**
 * design.md §21 Phase 1-3's real evaluator, replacing what used to be
 * `apps/control/src/db/seed.ts`-fabricated `pr_decision_snapshot` rows (see
 * apps/control/README.md's former "Scope" note — now out of date, this is
 * that real evaluator). Orchestrates: fetch authoritative PR/tree facts →
 * scope/policy → approval continuity (on head change) → G1/G3 gate
 * evaluation → state machine → write projections → update GitHub summary.
 * Runs once per `evaluate_policy`/`ingest_check_result` outbox item.
 */
export function evaluatePr(ctx: ControlContext, work: OutboxWork): Promise<void> {
	return withSpan(
		"evaluate_pr",
		{ repositoryId: toRepositoryId(work.repositoryId ?? 0) },
		async () => {
			const facts = parseEventFacts(work.payload);
			if (!facts.repoFullName || facts.pullRequestNumber === null) return;
			const [owner, name] = facts.repoFullName.split("/");
			if (!owner || !name) return;

			const repoId = facts.repoFullName;
			const prNumber = facts.pullRequestNumber;
			const branded = toPullRequestNumber(prNumber);
			const repo: RepoRef = {
				installationId: toInstallationId(work.installationId),
				repositoryId: toRepositoryId(work.repositoryId ?? 0),
				owner,
				name,
			};

			await ensureRepositoryRow(
				ctx,
				repoId,
				facts.repoFullName,
				work.installationId,
				work.repositoryId,
			);

			const prInfo = await ctx.github.getPullRequest(repo, branded);
			const files = await ctx.github.listPullRequestFiles(repo, branded);
			const policy = await loadEffectivePolicy(ctx, repoId);
			const touchedScopeIds = scopesForTouchedPaths(policy, files.map((f) => f.filename));

			await syncScopeRequirements(ctx, repoId, prNumber, policy, touchedScopeIds);

			const previous = await loadPreviousRevision(ctx, repoId, prNumber);
			if (previous && previous.headSha !== prInfo.headSha && previous.baseSha) {
				await reconfirmApprovalsOnSynchronize(ctx.db, ctx.github, repo, policy, {
					repoId,
					prNumber,
					oldBaseSha: previous.baseSha,
					oldHeadSha: previous.headSha,
					newBaseSha: prInfo.baseSha,
					newHeadSha: prInfo.headSha,
				});
			}

			const approvals = await loadApprovalFacts(ctx, repoId, prNumber);
			const checks = await loadCheckFacts(ctx, repoId, prNumber);
			const evaluationInput: EvaluationInput = {
				candidate: { touchedScopeIds, isDraft: prInfo.isDraft },
				approvals,
				checks,
				queue: { repoStatus: await loadRepoStatus(ctx, repoId) },
			};
			const result = evaluate(evaluationInput, policy);

			await advanceState(ctx, repoId, prNumber, previous, prInfo, result.gateConclusion);
			await writeDecisionSnapshot(ctx, repoId, prNumber, result, checks);
			await writeBlockedEntry(ctx, repoId, prNumber, prInfo.authorStableId, result);
			await postSummary(ctx, repo, branded, prInfo, result);
		},
	);
}

async function ensureRepositoryRow(
	ctx: ControlContext,
	repoId: string,
	fullName: string,
	installationId: number,
	githubRepositoryId: number | null,
): Promise<void> {
	await ctx.db
		.insert(repository)
		.values({
			repoId,
			installationId,
			githubRepositoryId,
			name: fullName,
			mode: "serial",
			status: "active",
			metrics: {
				leadTime: { p50: 0, p95: 0 },
				reviewWait: { p50: 0, p95: 0 },
				ciDuration: { p50: 0, p95: 0 },
				queueWait: { p50: 0, p95: 0 },
				internalTime: { p50: 0, p95: 0 },
			},
			lastWebhookAt: new Date(),
		})
		.onConflictDoUpdate({
			target: repository.repoId,
			set: { lastWebhookAt: new Date(), githubRepositoryId },
		});
}

/**
 * design.md §9.1/§22: reads the repo's effective `policy_bundle` (matched by
 * `repository.policyVersion`, a digest) if one has been published; falls
 * back to `DEFAULT_POLICY` otherwise. No org→repo→branch authoring UI exists
 * yet (§21's later-phase console work) — this is the fail-closed-friendly
 * bootstrap `default-policy.ts`'s own comment documents.
 */
async function loadEffectivePolicy(ctx: ControlContext, repoId: string): Promise<CompiledPolicy> {
	const [repoRow] = await ctx.db.select().from(repository).where(eq(repository.repoId, repoId))
		.limit(1);
	if (repoRow?.policyVersion) {
		const [bundle] = await ctx.db
			.select()
			.from(policyBundle)
			.where(eq(policyBundle.digest, repoRow.policyVersion))
			.limit(1);
		if (bundle) {
			const parsed = JSON.parse(bundle.rawYaml);
			const compiled = await compilePolicy(parsed, null, null);
			if (compiled.ok) return compiled.value;
		}
	}
	const compiled = await compilePolicy(DEFAULT_POLICY, null, null);
	if (!compiled.ok) {
		throw new Error("DEFAULT_POLICY failed to compile — this is a bug, not a user error");
	}
	return compiled.value;
}

async function syncScopeRequirements(
	ctx: ControlContext,
	repoId: string,
	prNumber: number,
	policy: CompiledPolicy,
	touchedScopeIds: readonly ScopeId[],
): Promise<void> {
	await ctx.db
		.delete(prScopeRequirement)
		.where(and(eq(prScopeRequirement.repoId, repoId), eq(prScopeRequirement.prNumber, prNumber)));

	const rows = touchedScopeIds.flatMap((scopeId) => {
		const rule = policy.scopeIndex.get(scopeId);
		if (!rule) return [];
		return rule.require.approvals.map((a) => ({
			repoId,
			prNumber,
			scopeId: String(scopeId),
			requiredRole: approverRoleToDashboardRole(a.role),
		}));
	});
	if (rows.length > 0) await ctx.db.insert(prScopeRequirement).values(rows);
}

interface PreviousRevision {
	readonly state: PrState;
	readonly stateVersion: number;
	readonly headSha: string;
	readonly baseSha: string;
	readonly lastObservedAt: Date;
}

async function loadPreviousRevision(
	ctx: ControlContext,
	repoId: string,
	prNumber: number,
): Promise<PreviousRevision | null> {
	const [row] = await ctx.db
		.select()
		.from(pullRequestRevision)
		.where(and(eq(pullRequestRevision.repoId, repoId), eq(pullRequestRevision.prNumber, prNumber)))
		.limit(1);
	if (!row) return null;
	return {
		// DB stores lower_snake_case (design.md-adjacent MVP convention);
		// PrState (packages/domain) is the same vocabulary in SCREAMING_SNAKE.
		state: row.state.toUpperCase() as PrState,
		stateVersion: row.stateVersion,
		headSha: row.headSha,
		baseSha: row.baseSha,
		lastObservedAt: row.updatedAt,
	};
}

async function loadApprovalFacts(
	ctx: ControlContext,
	repoId: string,
	prNumber: number,
): Promise<ApprovalFact[]> {
	const rows = await ctx.db
		.select()
		.from(approvalTable)
		.where(
			and(
				eq(approvalTable.repoId, repoId),
				eq(approvalTable.prNumber, prNumber),
			),
		);
	return rows
		.map((r) => {
			const role = dashboardRoleToApproverRole(r.role);
			if (!role) return null; // operator/maintainer/developer: not a policy approval role
			return {
				scopeId: r.scopeId as ScopeId,
				role,
				actorStableId: toActorStableId(r.actorStableId),
				maintained: r.maintained && r.revokedAt === null,
			};
		})
		.filter((f): f is ApprovalFact => f !== null);
}

/**
 * MVP simplification: there is no dynamic expected-check-plan builder or
 * live CI evidence ingestion pipeline in this pass (design.md §13 is a large
 * separate subsystem) — this reads whatever `pr_decision_snapshot.checks`
 * already holds from the last evaluation (empty for a brand-new PR) rather
 * than computing a fresh expected set. A scope with no declared checks
 * therefore evaluates G3 as trivially satisfied, which is correct given an
 * empty required-check set; populating real expected/observed checks is
 * tracked as follow-up work, not silently faked.
 */
async function loadCheckFacts(
	ctx: ControlContext,
	repoId: string,
	prNumber: number,
): Promise<CheckFact[]> {
	const [snapshot] = await ctx.db
		.select({ checks: prDecisionSnapshot.checks })
		.from(prDecisionSnapshot)
		.where(and(eq(prDecisionSnapshot.repoId, repoId), eq(prDecisionSnapshot.prNumber, prNumber)))
		.limit(1);
	if (!snapshot) return [];
	return snapshot.checks.map((c) => ({
		jobName: c.job,
		required: c.expected,
		conclusion: c.conclusion,
		trustedRunner: c.trustedRunner,
	}));
}

async function loadRepoStatus(
	ctx: ControlContext,
	repoId: string,
): Promise<"active" | "paused" | "draining"> {
	const [row] = await ctx.db.select({ status: repository.status }).from(repository).where(
		eq(repository.repoId, repoId),
	).limit(1);
	return row?.status ?? "active";
}

/** design.md §5's `PrState` derivation from the pure gate `evaluate()`
 * result — a display-level mapping, not a full re-derivation of every §5.1
 * transition (queue/candidate/merge states are set by
 * worker/serial-scheduler.ts, not here). */
function nextDisplayState(
	isDraft: boolean,
	gateConclusion: "PASS" | "BLOCKED" | "PENDING",
): PrState {
	if (isDraft) return "DRAFT";
	if (gateConclusion === "PASS") return "APPROVAL_COVERED";
	return "REVIEWING";
}

type DbPrState =
	| "discovered"
	| "draft"
	| "reviewing"
	| "approval_covered"
	| "prechecked"
	| "queued"
	| "candidate_building"
	| "gate_passed"
	| "merging"
	| "merged"
	| "observing"
	| "superseded"
	| "paused"
	| "quarantined"
	| "reverting";

/** `PrState` (packages/domain, SCREAMING_SNAKE) → the DB's lower_snake_case
 * storage form — an exhaustive `Record` so a new `PrState` member fails to
 * compile here instead of silently `.toLowerCase()`-ing into an unchecked
 * string, the way an `as never` cast would let it. */
const DB_STATE: Readonly<Record<PrState, DbPrState>> = {
	DISCOVERED: "discovered",
	DRAFT: "draft",
	REVIEWING: "reviewing",
	APPROVAL_COVERED: "approval_covered",
	PRECHECKED: "prechecked",
	QUEUED: "queued",
	CANDIDATE_BUILDING: "candidate_building",
	GATE_PASSED: "gate_passed",
	MERGING: "merging",
	MERGED: "merged",
	OBSERVING: "observing",
	SUPERSEDED: "superseded",
	PAUSED: "paused",
	QUARANTINED: "quarantined",
	REVERTING: "reverting",
};

async function advanceState(
	ctx: ControlContext,
	repoId: string,
	prNumber: number,
	previous: PreviousRevision | null,
	prInfo: {
		readonly headSha: string;
		readonly baseSha: string;
		readonly isDraft: boolean;
		readonly authorStableId: string;
	},
	gateConclusion: "PASS" | "BLOCKED" | "PENDING",
): Promise<void> {
	const now = new Date();
	const current: PrStateRow = previous
		? {
			state: previous.state,
			stateVersion: previous.stateVersion,
			headSha: toSha(previous.headSha),
			candidateSha: null,
			lastObservedAt: previous.lastObservedAt,
		}
		: {
			state: "DISCOVERED",
			stateVersion: 0,
			headSha: toSha(prInfo.headSha),
			candidateSha: null,
			lastObservedAt: new Date(0),
		};

	const toState = nextDisplayState(prInfo.isDraft, gateConclusion);
	const inputDigest = await sha256HexOf(
		new TextEncoder().encode(`${gateConclusion}:${prInfo.headSha}:${prInfo.baseSha}`),
	);
	const event: StateEvent = {
		operationId: generateOperationId(),
		toState,
		actor: { kind: "yoroi", stableId: null },
		reasonCode: `gate_${gateConclusion.toLowerCase()}`,
		observedHeadSha: toSha(prInfo.headSha),
		inputDigest,
		occurredAt: now,
	};

	// 初回発見時はDISCOVERED→DRAFT/REVIEWINGの遷移から始める(§5.1)。以降は
	// current.stateがtoStateとして許可されていない場合、無理に遷移させず
	// 現在のstateのまま投影を更新する(表示状態の後退防止 P-05はreduce内で保証)。
	const transition = reduce(current, event);
	const nextRow = transition.ok
		? transition.value
		: { ...current, headSha: toSha(prInfo.headSha), lastObservedAt: now };

	await ctx.db
		.insert(pullRequestRevision)
		.values({
			repoId,
			prNumber,
			headSha: prInfo.headSha,
			baseSha: prInfo.baseSha,
			isDraft: prInfo.isDraft,
			authorStableId: prInfo.authorStableId,
			state: DB_STATE[nextRow.state],
			stateVersion: nextRow.stateVersion,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [pullRequestRevision.repoId, pullRequestRevision.prNumber],
			set: {
				headSha: prInfo.headSha,
				baseSha: prInfo.baseSha,
				isDraft: prInfo.isDraft,
				state: DB_STATE[nextRow.state],
				stateVersion: nextRow.stateVersion,
				updatedAt: now,
			},
		});
}

/** packages/policy's `ReasonGraphNode.children` is `readonly ReasonGraphNode[]`
 * (Functional Core immutability); the jsonb column's `.$type<>()` narrowing
 * (packages/postgres/src/schema.ts) declares a plain mutable array, since
 * jsonb round-trips through JSON either way. A structural clone breaks the
 * `readonly` without changing any actual value. */
function toMutableReasonGraph(
	node: ReasonGraphNode,
): { label: string; children: ReturnType<typeof toMutableReasonGraph>[] } {
	return { label: node.label, children: node.children.map(toMutableReasonGraph) };
}

async function writeDecisionSnapshot(
	ctx: ControlContext,
	repoId: string,
	prNumber: number,
	result: ReturnType<typeof evaluate>,
	checks: readonly CheckFact[],
): Promise<void> {
	const hasCiFailure = checks.some((c) =>
		c.conclusion === "failure" || c.conclusion === "timed_out"
	);
	await ctx.db
		.insert(prDecisionSnapshot)
		.values({
			repoId,
			prNumber,
			conclusion: gateConclusionToPrConclusion(result.gateConclusion),
			// G1/G3はpackages/policyのevaluate()が実際に判定する。G2(candidate
			// integrity)/G4(merge authorization)はSerial Scheduler/Merger側の
			// 責務(§10-12)であり、ここでは"waiting"のプレースホルダに留める。
			gates: [
				{
					gate: "g1",
					status: gateStatusFor(result, "G1"),
					reason: result.reasonGraph.label,
					nextAction: "",
					waitingOn: null,
				},
				{
					gate: "g2",
					status: "waiting",
					reason: "candidate未構築",
					nextAction: "",
					waitingOn: null,
				},
				{
					gate: "g3",
					status: gateStatusFor(result, "G3"),
					reason: result.reasonGraph.label,
					nextAction: "",
					waitingOn: null,
				},
				{ gate: "g4", status: "waiting", reason: "queue未到達", nextAction: "", waitingOn: null },
			],
			checks: checks.map((c) => ({
				job: c.jobName,
				expected: c.required,
				// apps/control/src/domain/types.ts's dashboard CheckConclusion has no
				// "timed_out" variant distinct from "failure" (§9.3's finer-grained
				// distinction is a gate-evaluation concern, already applied above by
				// `evaluate()` — this is a display simplification only, not a gate
				// weakening: a timed-out check already failed G3 before reaching here).
				conclusion: c.conclusion === "timed_out" ? "failure" : c.conclusion,
				trustedRunner: c.trustedRunner,
			})),
			reasonGraph: toMutableReasonGraph(result.reasonGraph),
			allGatesPassed: result.gateConclusion === "PASS",
			hasCiFailure,
			updatedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [prDecisionSnapshot.repoId, prDecisionSnapshot.prNumber],
			set: {
				conclusion: gateConclusionToPrConclusion(result.gateConclusion),
				reasonGraph: toMutableReasonGraph(result.reasonGraph),
				allGatesPassed: result.gateConclusion === "PASS",
				hasCiFailure,
				updatedAt: new Date(),
			},
		});
}

function gateStatusFor(
	result: ReturnType<typeof evaluate>,
	gate: "G1" | "G3",
): "passed" | "waiting" | "failed" | "unknown" {
	const blockedByThisGate = result.reasonGraph.children.some((c) => c.label.includes(gate));
	if (!blockedByThisGate && result.gateConclusion === "PASS") return "passed";
	if (blockedByThisGate) return result.gateConclusion === "PENDING" ? "waiting" : "failed";
	return result.gateConclusion === "PENDING" ? "waiting" : "passed";
}

function gateConclusionToPrConclusion(gateConclusion: "PASS" | "BLOCKED" | "PENDING") {
	if (gateConclusion === "PASS") return { kind: "mergeable" as const };
	if (gateConclusion === "PENDING") return { kind: "waiting_ci" as const };
	return { kind: "policy_violation" as const };
}

async function writeBlockedEntry(
	ctx: ControlContext,
	repoId: string,
	prNumber: number,
	authorStableId: string,
	result: ReturnType<typeof evaluate>,
): Promise<void> {
	if (result.gateConclusion === "PASS") {
		await ctx.db.delete(blockedEntry).where(
			and(eq(blockedEntry.repoId, repoId), eq(blockedEntry.prNumber, prNumber)),
		);
		return;
	}

	const responsibility = classifyResponsibility({
		gateConclusion: result.gateConclusion,
		reasonGraph: toMutableReasonGraph(result.reasonGraph),
		isAuthor: false,
		githubApiDegraded: false,
	});

	await ctx.db
		.insert(blockedEntry)
		.values({
			repoId,
			prNumber,
			responsibility,
			reason: result.reasonGraph.label,
			nextActor: responsibility === "your_action" ? authorStableId : "reviewer",
		})
		.onConflictDoUpdate({
			target: [blockedEntry.repoId, blockedEntry.prNumber],
			set: { responsibility, reason: result.reasonGraph.label },
		});
}

function toSummaryState(
	isDraft: boolean,
	gateConclusion: "PASS" | "BLOCKED" | "PENDING",
): SummaryState {
	if (isDraft) {
		return {
			stage: "review",
			reasonHeadline: "Draft中のためcandidate/queueは開始されていません (FR-096)",
			nextActor: "author",
			etaRange: null,
			confidence: null,
		};
	}
	if (gateConclusion === "PASS") {
		return {
			stage: "queue",
			reasonHeadline: "全gateに合格し、queueへの投入対象です",
			nextActor: "yoroi",
			etaRange: null,
			confidence: null,
		};
	}
	if (gateConclusion === "PENDING") {
		return {
			stage: "ci",
			reasonHeadline: "必須checkの完了待ちです",
			nextActor: "yoroi",
			etaRange: null,
			confidence: null,
		};
	}
	return {
		stage: "block",
		reasonHeadline: "承認またはcheckが不足しています",
		nextActor: "reviewer",
		etaRange: null,
		confidence: null,
	};
}

async function postSummary(
	ctx: ControlContext,
	repo: RepoRef,
	prNumber: ReturnType<typeof toPullRequestNumber>,
	prInfo: { readonly headSha: string; readonly isDraft: boolean },
	result: ReturnType<typeof evaluate>,
): Promise<void> {
	const [anchorRow] = await ctx.db
		.select()
		.from(notificationAnchor)
		.where(
			and(
				eq(notificationAnchor.installationId, repo.installationId),
				eq(notificationAnchor.repositoryId, repo.repositoryId),
				eq(notificationAnchor.pullRequestNumber, prNumber),
			),
		)
		.limit(1);

	const anchor: NotificationAnchorState = {
		summaryCommentId: anchorRow?.summaryCommentId ?? null,
		checkRunId: anchorRow?.checkRunId ?? null,
		lastReasonHash: anchorRow?.lastReasonHash ?? null,
	};

	const state = toSummaryState(prInfo.isDraft, result.gateConclusion);
	const upserted = await upsertSummary(
		ctx.github,
		repo,
		prNumber,
		toSha(prInfo.headSha),
		anchor,
		state,
		result.reasonGraph,
	);

	await ctx.db
		.insert(notificationAnchor)
		.values({
			installationId: repo.installationId,
			repositoryId: repo.repositoryId,
			pullRequestNumber: prNumber,
			summaryCommentId: upserted.summaryCommentId,
			checkRunId: upserted.checkRunId,
			lastReasonHash: upserted.reasonHash,
		})
		.onConflictDoUpdate({
			target: [
				notificationAnchor.installationId,
				notificationAnchor.repositoryId,
				notificationAnchor.pullRequestNumber,
			],
			set: {
				summaryCommentId: upserted.summaryCommentId,
				checkRunId: upserted.checkRunId,
				lastReasonHash: upserted.reasonHash,
				updatedAt: new Date(),
			},
		});
}
