import type { PolicyDocument } from "@yoroi/policy";

/**
 * design.md §9.1's schema, populated with a conservative baseline: a single
 * `**` scope requiring one reviewer, Serial queue mode, exact-content
 * approval continuity, Draft PRs skip Candidate/dynamic CI. Used by
 * `loadEffectivePolicy` (./evaluate-pr.ts) only when no `policy_bundle` row
 * exists yet for a repo — every real repo is expected to get its own policy
 * once the (not-yet-built) policy authoring/console flow exists; this is a
 * fail-closed-friendly bootstrap, not a design.md-specified default.
 */
export const DEFAULT_POLICY: PolicyDocument = {
	version: "yoroi/v2",
	defaults: {
		gate_check: "yoroi/gate",
		queue: { mode: "serial", aging: "p50-based" },
		approval_continuity: {
			algorithm: "scope-change-v1",
			whitespace: "exact",
			context_proof: "deterministic-replay",
			high_risk_base_overlap: "reapprove",
			ambiguous: "invalidate-affected",
		},
		draft: { candidate: "disabled", checks: [] },
		questionnaire: { mode: "triggered" },
		notifications: { mutable_summary: true, coalesce: "10m" },
	},
	scopes: [
		{
			id: "default",
			match: ["**"],
			require: { approvals: [{ role: "reviewer", count: 1 }] },
		},
	],
	break_glass: {
		approvals: 2,
		distinct_actors: true,
		max_ttl: "2h",
		require_ticket: true,
		require_post_review: true,
	},
};
