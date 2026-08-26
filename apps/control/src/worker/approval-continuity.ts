import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@yoroi/postgres";
import { approval, approvalCarryForward } from "@yoroi/postgres";
import type { GitHubAdapter, RepoRef } from "@yoroi/github";
import { fetchBlobsForPaths, fetchCompleteTree } from "@yoroi/github";
import {
	createDataOnlyApplyEngine,
	evaluateContextSafety,
	scopeId as toScopeId,
	sha,
} from "@yoroi/domain";
import type { FetchedTree } from "@yoroi/domain";
import type { CompiledPolicy } from "@yoroi/policy";

function changedPaths(before: FetchedTree, after: FetchedTree): string[] {
	const beforeByPath = new Map(before.entries.map((e) => [e.path, e]));
	const changed: string[] = [];
	for (const entry of after.entries) {
		const prior = beforeByPath.get(entry.path);
		if (!prior || prior.oid !== entry.oid || prior.mode !== entry.mode) changed.push(entry.path);
	}
	return changed;
}

export interface ReconfirmApprovalsInput {
	readonly repoId: string;
	readonly prNumber: number;
	readonly oldBaseSha: string;
	readonly oldHeadSha: string;
	readonly newBaseSha: string;
	readonly newHeadSha: string;
}

/**
 * design.md §8.3/§8.4, DP-13: on a head change (force-push/rebase/new
 * commits) each currently-maintained approval's scope is re-checked against
 * the new base/head via the deterministic-replay context safety proof —
 * never assumed to still hold just because a human approved *some* earlier
 * version of this PR. A scope that proves continuity is carried forward
 * (an `approval_carry_forward` row records why, AT-04A/04F, §7.2); a scope
 * that can't prove it — content actually changed, or the proof came back
 * indeterminate (submodule/LFS/ambiguous rename/truncated tree) — is
 * invalidated (`maintained = false`), never left in an unknown state
 * (§8.4's safe-side-invalidate table).
 */
export async function reconfirmApprovalsOnSynchronize(
	db: Db,
	gh: GitHubAdapter,
	repo: RepoRef,
	policy: CompiledPolicy,
	input: ReconfirmApprovalsInput,
): Promise<void> {
	const maintainedApprovals = await db
		.select()
		.from(approval)
		.where(
			and(
				eq(approval.repoId, input.repoId),
				eq(approval.prNumber, input.prNumber),
				eq(approval.maintained, true),
				isNull(approval.revokedAt),
			),
		);
	if (maintainedApprovals.length === 0) return;

	const [oldBaseTree, oldHeadTree, newBaseTree, newHeadTree] = await Promise.all([
		fetchCompleteTree(gh, repo, sha(input.oldBaseSha)),
		fetchCompleteTree(gh, repo, sha(input.oldHeadSha)),
		fetchCompleteTree(gh, repo, sha(input.newBaseSha)),
		fetchCompleteTree(gh, repo, sha(input.newHeadSha)),
	]);
	// diffToCanonicalRecords (inside evaluateContextSafety) reads blob bytes
	// off the *after* side of each pair only — fetch exactly those, not the
	// whole tree, per fetchBlobsForPaths's own doc comment.
	const [oldHeadWithBlobs, newHeadWithBlobs] = await Promise.all([
		fetchBlobsForPaths(gh, repo, oldHeadTree, changedPaths(oldBaseTree, oldHeadTree)),
		fetchBlobsForPaths(gh, repo, newHeadTree, changedPaths(newBaseTree, newHeadTree)),
	]);

	const scopeIds = [...new Set(maintainedApprovals.map((a) => a.scopeId))];
	const engine = createDataOnlyApplyEngine();

	for (const scope of scopeIds) {
		const rule = policy.scopeIndex.get(toScopeId(scope));
		if (!rule) continue;
		// MVP: policy schema (packages/policy/src/schema.ts) has no per-scope
		// "sensitive path" field yet (§7.3's high-sensitivity-path extension
		// point) — empty until that's added, so `hasSensitivePathOverlap`
		// always evaluates false and this never forces a context-reapproval on
		// that basis alone.
		const sensitivePatterns: string[] = [];

		const proof = await evaluateContextSafety(
			{
				oldBase: oldBaseTree,
				oldHead: oldHeadWithBlobs,
				newBase: newBaseTree,
				newHead: newHeadWithBlobs,
			},
			engine,
			{
				scopeId: toScopeId(scope),
				oldBaseSha: sha(input.oldBaseSha),
				oldHeadSha: sha(input.oldHeadSha),
				newBaseSha: sha(input.newBaseSha),
				newHeadSha: sha(input.newHeadSha),
				scopeMappingVersion: "v1",
				scopePatterns: rule.match,
				sensitivePatterns,
			},
		);

		if (proof.outcome === "carried_forward") {
			for (const row of maintainedApprovals.filter((a) => a.scopeId === scope)) {
				await db.insert(approvalCarryForward).values({
					originalApprovalId: row.id,
					repoId: input.repoId,
					prNumber: input.prNumber,
					scopeId: scope,
					oldBaseSha: input.oldBaseSha,
					oldHeadSha: input.oldHeadSha,
					newBaseSha: input.newBaseSha,
					newHeadSha: input.newHeadSha,
					contextProofDigest: proof.replayedResultDigest ?? "",
					proofAlgorithm: proof.proofAlgorithm,
				});
			}
			continue;
		}

		await db
			.update(approval)
			.set({ maintained: false, revokedAt: new Date(), revokeReason: proof.reason })
			.where(
				and(
					eq(approval.repoId, input.repoId),
					eq(approval.prNumber, input.prNumber),
					eq(approval.scopeId, scope),
				),
			);
	}
}
