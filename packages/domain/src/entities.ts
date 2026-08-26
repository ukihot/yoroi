import type {
	ActorStableId,
	PolicyDigest,
	PullRequestNumber,
	RepositoryId,
	ScopeId,
	Sha,
	Sha256Hex,
} from "./ids.ts";
import type { ApproverRole } from "./identity.ts";

/** design.md §4.3, verbatim (field names as shown; implementations map these 1:1 to DB columns). */

export interface PullRequestRevision {
	readonly repositoryId: RepositoryId;
	readonly pullRequestNumber: PullRequestNumber;
	readonly headSha: Sha;
	readonly baseSha: Sha;
	readonly isDraft: boolean;
	readonly authorStableId: ActorStableId;
	readonly touchedScopes: readonly ScopeId[];
	readonly sensitiveScopes: readonly ScopeId[];
}

export interface MergeCandidate {
	readonly candidateSha: Sha;
	readonly baseSha: Sha;
	readonly orderedHeads: readonly Sha[];
	readonly policyDigest: PolicyDigest;
	readonly builtAt: Date;
	readonly invalidatedAt: Date | null;
	readonly invalidationReason: string | null;
}

export interface Approval {
	readonly actorStableId: ActorStableId;
	readonly role: ApproverRole;
	readonly scopeId: ScopeId;
	readonly scopeChangeDigest: Sha256Hex;
	readonly contextProofPolicy: string;
	readonly policyDigest: PolicyDigest;
	readonly originalHeadSha: Sha; // 監査文脈
	readonly originalBaseSha: Sha; // 監査文脈
	readonly scopeResultDigest: Sha256Hex;
	readonly approvedAt: Date;
}

export interface ApprovalCarryForward {
	readonly originalReviewId: string;
	readonly oldBaseSha: Sha;
	readonly oldHeadSha: Sha;
	readonly newBaseSha: Sha;
	readonly newHeadSha: Sha;
	readonly unchangedScopeIds: readonly ScopeId[];
	readonly contextProofDigest: Sha256Hex;
	readonly proofAlgorithm: string;
}
