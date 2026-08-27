import { and, eq, notInArray } from "drizzle-orm";
import { compilePolicy } from "@yoroi/policy";
import { db } from "../db/client.ts";
import { policyBundle, pullRequestRevision, repository } from "@yoroi/postgres";
import { json } from "../lib/http.ts";
import { DEFAULT_POLICY } from "../worker/default-policy.ts";
import type { RouteHandler } from "../app.ts";
import type { RepoPolicySummary } from "../domain/types.ts";

/** Same compile call `worker/evaluate-pr.ts`'s `loadEffectivePolicy` makes
 * when no `policy_bundle` row exists — computed once here since it's
 * identical for every repo currently falling back to it. */
async function defaultPolicyDigest(): Promise<string> {
	const compiled = await compilePolicy(DEFAULT_POLICY, null, null);
	if (!compiled.ok) {
		throw new Error("DEFAULT_POLICY failed to compile — this is a bug, not a user error");
	}
	return compiled.value.digest;
}

/**
 * design.md §23.11 Policy & Drift screen — **Policy half only**. Design.md's
 * own scope note in that section draws the line for us: policy
 * version/digest and affected-Open-PR display use existing Chapter 9 Policy
 * Engine data and are explicitly callable "初期リリースの対象"
 * (in scope for the initial release); the GitHub構成/Drift half is
 * explicitly Phase 5 Org Governance, "本書ではまだ詳細化していない"
 * (not yet detailed in this document), and is to be treated as a
 * placeholder until that phase is designed. This module only ever produces
 * the Policy half — the console keeps rendering the existing placeholder
 * copy for GitHub構成/Drift unchanged.
 *
 * `openPrCount` is computed live from `pull_request_revision.state`, not
 * from `repository.open_prs` (that rollup column has no live writer yet —
 * see worker/cron-jobs.ts's comments on the same gap for other rollup
 * columns) — this is more accurate, not less, than the existing convention.
 */
export async function loadPolicySummaries(): Promise<RepoPolicySummary[]> {
	const [repos, fallbackDigest] = await Promise.all([
		db
			.select({
				repoId: repository.repoId,
				repoName: repository.name,
				policyVersion: repository.policyVersion,
			})
			.from(repository),
		defaultPolicyDigest(),
	]);

	return Promise.all(
		repos.map(async (repo) => {
			const [openPrRow, bundle] = await Promise.all([
				db
					.select({ prNumber: pullRequestRevision.prNumber })
					.from(pullRequestRevision)
					.where(
						and(
							eq(pullRequestRevision.repoId, repo.repoId),
							notInArray(pullRequestRevision.state, ["merged", "superseded"]),
						),
					),
				repo.policyVersion
					? db.select().from(policyBundle).where(eq(policyBundle.digest, repo.policyVersion)).limit(
						1,
					)
					: Promise.resolve([]),
			]);

			const publishedBundle = bundle[0];
			const summary: RepoPolicySummary = publishedBundle
				? {
					repoId: repo.repoId,
					repoName: repo.repoName,
					policyDigest: publishedBundle.digest,
					source: "published_bundle",
					version: publishedBundle.version,
					publishedAt: publishedBundle.createdAt.toISOString(),
					openPrCount: openPrRow.length,
				}
				: {
					repoId: repo.repoId,
					repoName: repo.repoName,
					policyDigest: fallbackDigest,
					source: "default_fallback",
					version: null,
					publishedAt: null,
					openPrCount: openPrRow.length,
				};
			return summary;
		}),
	);
}

export const handlePolicySummary: RouteHandler = async () => {
	return json(await loadPolicySummaries());
};
