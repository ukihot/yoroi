import type {
	ActorStableId,
	PolicyDigest,
	PullRequestNumber,
	RepositoryId,
	ScopeId,
	Sha,
	Sha256Hex,
} from "./ids.ts";

/** design.md §9.1's approval role vocabulary (policy YAML `role:` values). */
export type ApproverRole =
	| "reviewer"
	| "scope-approver"
	| "security-approver"
	| "data-approver"
	| "infra-approver"
	| "org-governor";

/**
 * design.md §4.2, verbatim. These two Identity types are **never mixed**
 * (DP-01 exact candidate / DP-13 content-aware approval): `approval` rows
 * reference only `ReviewIdentity`, `check_evidence`/merge execution
 * reference only `CandidateDecisionIdentity`.
 */

/** 人のreview continuityを表す単位。rebase等で不変なら維持される (DP-13) */
export interface ReviewIdentity {
	readonly repositoryId: RepositoryId;
	readonly pullRequestNumber: PullRequestNumber;
	readonly scopeId: ScopeId;
	readonly scopeChangeDigest: Sha256Hex;
	readonly contextSafetyProofDigest: Sha256Hex;
	readonly scopeMappingVersion: string;
	readonly policyDigest: PolicyDigest;
	readonly actorStableId: ActorStableId;
	readonly actorRole: ApproverRole;
}

/** 実行・merge権限に結合する単位。SHAが変われば必ず作り直す (DP-01) */
export interface CandidateDecisionIdentity {
	readonly repositoryId: RepositoryId;
	readonly pullRequestNumber: PullRequestNumber;
	readonly exactCandidateSha: Sha;
	readonly headSha: Sha;
	readonly baseSha: Sha;
	readonly orderedDependencyShas: readonly Sha[];
	readonly policyDigest: PolicyDigest;
	readonly expectedCheckPlanDigest: Sha256Hex;
}
