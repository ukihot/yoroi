import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { flakyTest, mergeCandidate, repository } from "@yoroi/postgres";
import { json } from "../lib/http.ts";
import type { RouteHandler } from "../app.ts";
import type { CiReliabilitySummary, FlakyTestRow } from "../domain/types.ts";

/**
 * design.md §23.9 CI Reliability screen, scoped to what already has a real
 * writer: `flaky_test` (`/yoroi flaky`, worker/slash-commands.ts) and
 * `merge_candidate` (worker/serial-scheduler.ts, including invalidation +
 * reason). `flaky_test.repository_id`/`merge_candidate.repository_id` are
 * GitHub's numeric repo id, joined against `repository.github_repository_id`
 * — the same column added to `packages/postgres`'s schema for exactly this
 * (see that table's own comment).
 *
 * Deliberately NOT here: per-workflow/job success rate, p50/p95 execution
 * time, retry-success rate, and circuit-breaker trips. Those need
 * `check_evidence`/`expected_check_plan` rows, which nothing in this
 * codebase writes yet, and a check-run start-time column that doesn't exist
 * either — see this app's plan notes. The console shows an honest note about
 * this instead of fabricating those numbers.
 */
export async function loadCiReliability(): Promise<CiReliabilitySummary> {
	const [flakyRows, candidateRows] = await Promise.all([
		db
			.select({
				testFingerprint: flakyTest.testFingerprint,
				repoName: repository.name,
				ownerTeam: flakyTest.ownerTeam,
				failureCount: flakyTest.failureCount,
				reproductionRate: flakyTest.reproductionRate,
				status: flakyTest.status,
				quarantineUntil: flakyTest.quarantineUntil,
			})
			.from(flakyTest)
			.leftJoin(repository, eq(repository.githubRepositoryId, flakyTest.repositoryId)),
		db
			.select({
				invalidatedAt: mergeCandidate.invalidatedAt,
				invalidationReason: mergeCandidate.invalidationReason,
			})
			.from(mergeCandidate),
	]);

	const flakyTests: FlakyTestRow[] = flakyRows
		.map((r) => ({
			testFingerprint: r.testFingerprint,
			repoName: r.repoName,
			ownerTeam: r.ownerTeam,
			failureCount: r.failureCount,
			reproductionRatePct: r.reproductionRate,
			status: r.status,
			quarantineUntil: r.quarantineUntil?.toISOString() ?? null,
		}))
		.sort((a, b) => b.failureCount - a.failureCount);

	const invalidated = candidateRows.filter((c) => c.invalidatedAt !== null);
	const reasonCounts = new Map<string, number>();
	for (const c of invalidated) {
		const reason = c.invalidationReason ?? "unknown";
		reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
	}

	return {
		flakyTests,
		candidatesBuilt: candidateRows.length,
		candidatesInvalidated: invalidated.length,
		invalidationReasons: [...reasonCounts.entries()]
			.map(([reason, count]) => ({ reason, count }))
			.sort((a, b) => b.count - a.count),
	};
}

export const handleCiReliability: RouteHandler = async () => {
	return json(await loadCiReliability());
};
