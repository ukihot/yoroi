import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { pullRequestRevision, queueEntry, repository } from "@yoroi/postgres";
import { json } from "../lib/http.ts";
import { minutesSince, toEta } from "../lib/format.ts";
import type { RouteHandler } from "../app.ts";
import type { QueueEntry } from "../domain/types.ts";

/**
 * Fleet-wide queue, not scoped to a single repo — deviates from design.md
 * §16's `GET /api/repos/{repositoryId}/queue`, kept as `GET /api/queue` to
 * match the contract `ControlApiPort.getMergeQueue()` already established in
 * the console app (its Merge Queue screen shows queue state across repos).
 */
export async function loadQueue(): Promise<QueueEntry[]> {
	const rows = await db
		.select({
			id: queueEntry.id,
			repoId: queueEntry.repoId,
			repoName: repository.name,
			prNumber: queueEntry.prNumber,
			title: pullRequestRevision.title,
			lane: queueEntry.lane,
			risk: queueEntry.risk,
			enqueuedAt: queueEntry.enqueuedAt,
			candidateSha: queueEntry.candidateSha,
			runningChecks: queueEntry.runningChecks,
			rebuildCount: queueEntry.rebuildCount,
			rebuildNoticeCausePr: queueEntry.rebuildNoticeCausePr,
			etaFrom: queueEntry.etaFrom,
			etaTo: queueEntry.etaTo,
			etaConfidence: queueEntry.etaConfidence,
		})
		.from(queueEntry)
		.innerJoin(repository, eq(repository.repoId, queueEntry.repoId))
		.leftJoin(
			pullRequestRevision,
			and(
				eq(pullRequestRevision.repoId, queueEntry.repoId),
				eq(pullRequestRevision.prNumber, queueEntry.prNumber),
			),
		)
		.orderBy(desc(queueEntry.priority), asc(queueEntry.enqueuedAt));

	return rows.map((r, i) => ({
		position: i + 1,
		pr: { repoId: r.repoId, repo: r.repoName, prNumber: r.prNumber, title: r.title ?? "" },
		lane: r.lane,
		risk: r.risk,
		agingMinutes: minutesSince(r.enqueuedAt),
		candidateSha: r.candidateSha,
		runningChecks: r.runningChecks ?? [],
		rebuildCount: r.rebuildCount,
		eta: toEta(r.etaFrom, r.etaTo, r.etaConfidence),
		rebuildNotice: r.rebuildNoticeCausePr != null ? { causePr: r.rebuildNoticeCausePr } : null,
	}));
}

export const handleQueue: RouteHandler = async () => {
	return json(await loadQueue());
};
