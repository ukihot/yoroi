import type { ReasonGraphNode } from '@yoroi/policy';

/**
 * design.md §23.2's shared taxonomy — classifies a blocked PR into who
 * should act, purely from an already-computed `ReasonGraphNode` (no new
 * judgment logic, per §23.2's own constraint: this only re-labels what the
 * Policy Engine already decided).
 */
export type BlockedResponsibility =
	| 'your_action'
	| 'other_reviewer'
	| 'ci'
	| 'queue'
	| 'yoroi_internal'
	| 'github_outage'
	| 'policy_blocked'
	| 'needs_investigation';

export interface ClassifyResponsibilityInput {
	readonly gateConclusion: 'PASS' | 'BLOCKED' | 'PENDING';
	readonly reasonGraph: ReasonGraphNode;
	/** whether the actor viewing this classification is the PR's author. */
	readonly isAuthor: boolean;
	/** github_api fleet_health_snapshot degraded (design.md §24.7/§13.4). */
	readonly githubApiDegraded: boolean;
}

function anyChildIncludes(node: ReasonGraphNode, needle: string): boolean {
	return node.children.some((c) => c.label.includes(needle));
}

/**
 * design.md §23.2. PASS PRs are never "blocked" by definition — callers
 * should only invoke this for BLOCKED/PENDING PRs; PASS is included in the
 * input type because the caller's snapshot carries it regardless, but this
 * function still returns a definite answer (`yoroi_internal`) rather than
 * throwing, since a caller mistake here shouldn't crash a dashboard render.
 */
export function classifyResponsibility(input: ClassifyResponsibilityInput): BlockedResponsibility {
	if (input.gateConclusion === 'PASS') return 'yoroi_internal';
	if (input.githubApiDegraded) return 'github_outage';

	if (anyChildIncludes(input.reasonGraph, 'G1 Identity / Approval')) {
		// The author's action is to request/secure the missing approval; a
		// reviewer viewing the same block is waiting on someone else's review.
		return input.isAuthor ? 'your_action' : 'other_reviewer';
	}
	if (anyChildIncludes(input.reasonGraph, 'G3 Test Evidence')) return 'ci';
	// packages/policy's evaluateQueueEligibility (§9.3) emits either
	// "draftのためcandidate対象外" or `repoが${repoStatus}中です` as a
	// top-level reason-graph child — the former is the author's own action
	// (mark ready for review), the latter is an operator-controlled repo state.
	if (input.reasonGraph.children.some((c) => c.label.includes('draftのため'))) {
		return input.isAuthor ? 'your_action' : 'queue';
	}
	if (
		input.reasonGraph.children.some((c) => c.label.includes('repoが') && c.label.includes('中です'))
	) {
		return 'queue';
	}
	if (input.reasonGraph.children.some((c) => c.label.includes('policy'))) return 'policy_blocked';
	return 'needs_investigation';
}
