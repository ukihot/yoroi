import { matchesGlob } from "@yoroi/domain";
import type { ActorStableId, ApproverRole, ScopeId } from "@yoroi/domain";
import type { CompiledPolicy } from "./compile.ts";
import { buildReasonGraph, type ReasonGraphNode } from "./reason-graph.ts";

export interface ApprovalFact {
	readonly scopeId: ScopeId;
	readonly role: ApproverRole;
	readonly actorStableId: ActorStableId;
	/** false when the scope changed since this approval — carry-forward
	 * invalidated it (design.md §8's ContextSafetyProof outcome). */
	readonly maintained: boolean;
}

export type CheckConclusion = "success" | "failure" | "cancelled" | "timed_out" | "pending" | null;

export interface CheckFact {
	readonly jobName: string;
	readonly required: boolean;
	readonly conclusion: CheckConclusion;
	readonly trustedRunner: boolean;
}

export interface MergeCandidateFacts {
	readonly touchedScopeIds: readonly ScopeId[];
	readonly isDraft: boolean;
}

export interface QueueFacts {
	readonly repoStatus: "active" | "paused" | "draining";
}

export interface EvaluationInput {
	readonly candidate: MergeCandidateFacts;
	readonly approvals: readonly ApprovalFact[];
	readonly checks: readonly CheckFact[];
	readonly queue: QueueFacts;
}

export interface EvaluationResult {
	readonly gateConclusion: "PASS" | "BLOCKED" | "PENDING";
	readonly reasonGraph: ReasonGraphNode;
}

function matchingScopeRule(policy: CompiledPolicy, scopeId: ScopeId) {
	return policy.scopeIndex.get(scopeId);
}

function evaluateApprovalCoverage(input: EvaluationInput, policy: CompiledPolicy) {
	const missing: { scopeId: ScopeId; role: ApproverRole; have: number; need: number }[] = [];

	for (const scopeId of input.candidate.touchedScopeIds) {
		const rule = matchingScopeRule(policy, scopeId);
		if (!rule) continue; // scope未定義のpathはpolicy側の設定漏れ。fail-openにしない: 上流でscope未マッピングは別途扱う
		for (const approvalRule of rule.require.approvals) {
			const have = input.approvals.filter(
				(a) => a.scopeId === scopeId && a.role === approvalRule.role && a.maintained,
			).length;
			if (have < approvalRule.count) {
				missing.push({ scopeId, role: approvalRule.role, have, need: approvalRule.count });
			}
		}
	}

	return { pass: missing.length === 0, missing };
}

function evaluateExpectedChecks(input: EvaluationInput) {
	const required = input.checks.filter((c) => c.required);
	const failedJobs = required.filter((c) =>
		c.conclusion === "failure" || c.conclusion === "timed_out" ||
		(c.conclusion === "success" && !c.trustedRunner)
	).map(
		(c) => c.jobName,
	);
	const pendingJobs = required.filter((c) => c.conclusion === null || c.conclusion === "pending")
		.map((c) => c.jobName);
	const pass = failedJobs.length === 0 && pendingJobs.length === 0;
	return {
		pass,
		pending: failedJobs.length === 0 && pendingJobs.length > 0,
		failedJobs,
		pendingJobs,
	};
}

function evaluateQueueEligibility(input: EvaluationInput) {
	if (input.candidate.isDraft) return { pass: false, reason: "draftのためcandidate対象外" };
	if (input.queue.repoStatus !== "active") {
		return { pass: false, reason: `repoが${input.queue.repoStatus}中です` };
	}
	return { pass: true, reason: null };
}

/** design.md §9.3. Pure function: I/O を含まない (FR-011: 同じ入力→同じ判定+reason graph)。
 * `matchesGlob` (packages/domain) resolves each touched scope path against
 * §9.1's `match:` glob patterns. */
export function evaluate(input: EvaluationInput, policy: CompiledPolicy): EvaluationResult {
	const approvalResult = evaluateApprovalCoverage(input, policy);
	const checkResult = evaluateExpectedChecks(input);
	const queueResult = evaluateQueueEligibility(input);

	const gateConclusion: EvaluationResult["gateConclusion"] =
		approvalResult.pass && checkResult.pass && queueResult.pass
			? "PASS"
			: checkResult.pending && approvalResult.pass && queueResult.pass
			? "PENDING"
			: "BLOCKED";

	return {
		gateConclusion,
		reasonGraph: buildReasonGraph({ approvalResult, checkResult, queueResult }),
	};
}

/** Which policy scope a path belongs to, via §9.1's `match:` glob patterns —
 * used by the orchestration layer to populate `MergeCandidateFacts.touchedScopeIds`. */
export function scopesForTouchedPaths(policy: CompiledPolicy, paths: readonly string[]): ScopeId[] {
	const touched = new Set<ScopeId>();
	for (const [scopeId, rule] of policy.scopeIndex) {
		if (paths.some((p) => rule.match.some((pattern) => matchesGlob(p, pattern)))) {
			touched.add(scopeId);
		}
	}
	return [...touched];
}
