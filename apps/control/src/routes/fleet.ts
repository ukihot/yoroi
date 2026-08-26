import { and, count, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
	blockedEntry,
	decisionEvent,
	fleetHealthSnapshot,
	prDecisionSnapshot,
	pullRequestRevision,
	queueEntry,
	repository,
} from "@yoroi/postgres";
import { json } from "../lib/http.ts";
import { toEta } from "../lib/format.ts";
import type { RouteHandler } from "../app.ts";
import type { BlockedEntry, FleetOverview, Responsibility } from "../domain/types.ts";

const ALL_RESPONSIBILITIES: Responsibility[] = [
	"your_action",
	"other_reviewer",
	"ci",
	"queue",
	"yoroi_internal",
	"github_outage",
	"policy_blocked",
	"needs_investigation",
];

export async function loadBlockedEntries(): Promise<BlockedEntry[]> {
	const rows = await db
		.select({
			repoId: blockedEntry.repoId,
			repoName: repository.name,
			prNumber: blockedEntry.prNumber,
			title: pullRequestRevision.title,
			responsibility: blockedEntry.responsibility,
			reason: blockedEntry.reason,
			nextActor: blockedEntry.nextActor,
			etaFrom: blockedEntry.etaFrom,
			etaTo: blockedEntry.etaTo,
			etaConfidence: blockedEntry.etaConfidence,
		})
		.from(blockedEntry)
		.innerJoin(repository, eq(repository.repoId, blockedEntry.repoId))
		.leftJoin(
			pullRequestRevision,
			and(
				eq(pullRequestRevision.repoId, blockedEntry.repoId),
				eq(pullRequestRevision.prNumber, blockedEntry.prNumber),
			),
		)
		.orderBy(desc(blockedEntry.createdAt));

	return rows.map((r) => ({
		pr: { repoId: r.repoId, repo: r.repoName, prNumber: r.prNumber, title: r.title ?? "" },
		responsibility: r.responsibility,
		reason: r.reason,
		nextActor: r.nextActor,
		eta: toEta(r.etaFrom, r.etaTo, r.etaConfidence),
	}));
}

export const handleFleetBlocked: RouteHandler = async () => {
	return json(await loadBlockedEntries());
};

export const handleFleetOverview: RouteHandler = async () => {
	const blocked = await loadBlockedEntries();
	const dayAgo = new Date(Date.now() - 24 * 60 * 60_000);
	const stalledCutoff = new Date(Date.now() - 180 * 60_000);

	const [
		[orgRow],
		[repoRow],
		[queuedRow],
		[gatePassedRow],
		[highRiskRow],
		[longStalledRow],
		[ciFailingRow],
		[mergedRow],
		[failedRow],
		[autoRevertedRow],
		githubHealth,
	] = await Promise.all([
		db.select({ organizations: sql<number>`count(distinct ${repository.installationId})` }).from(
			repository,
		),
		db.select({
			repositories: count(),
			openPrs: sql<number>`coalesce(sum(${repository.openPrs}), 0)`,
		}).from(repository),
		db.select({ queued: count() }).from(queueEntry),
		db.select({ gatePassed: count() }).from(prDecisionSnapshot).where(
			eq(prDecisionSnapshot.allGatesPassed, true),
		),
		db.select({ highRisk: count() }).from(queueEntry).where(eq(queueEntry.risk, "high")),
		db.select({ longStalled: count() }).from(queueEntry).where(
			lt(queueEntry.enqueuedAt, stalledCutoff),
		),
		db
			.select({ ciFailingRepos: sql<number>`count(distinct ${prDecisionSnapshot.repoId})` })
			.from(prDecisionSnapshot)
			.where(eq(prDecisionSnapshot.hasCiFailure, true)),
		db
			.select({ merged: count() })
			.from(decisionEvent)
			.where(
				and(
					eq(decisionEvent.operation, "merge"),
					eq(decisionEvent.result, "success"),
					gt(decisionEvent.occurredAt, dayAgo),
				),
			),
		db
			.select({ failed: count() })
			.from(decisionEvent)
			.where(
				and(
					eq(decisionEvent.operation, "merge"),
					eq(decisionEvent.result, "failure"),
					gt(decisionEvent.occurredAt, dayAgo),
				),
			),
		db
			.select({ autoReverted: count() })
			.from(decisionEvent)
			.where(and(eq(decisionEvent.operation, "auto_revert"), gt(decisionEvent.occurredAt, dayAgo))),
		db
			.select()
			.from(fleetHealthSnapshot)
			.where(eq(fleetHealthSnapshot.component, "github_api"))
			.orderBy(desc(fleetHealthSnapshot.observedAt))
			.limit(1),
	]);

	const counts = new Map<Responsibility, number>(ALL_RESPONSIBILITIES.map((r) => [r, 0]));
	for (const b of blocked) counts.set(b.responsibility, (counts.get(b.responsibility) ?? 0) + 1);

	const rateLimitRemainingPct = githubHealth[0]
		? Number((githubHealth[0].metric as Record<string, unknown>)?.rate_limit_remaining_pct ?? 100)
		: 100;

	const overview: FleetOverview = {
		organizations: Number(orgRow?.organizations ?? 0),
		repositories: Number(repoRow?.repositories ?? 0),
		openPrs: Number(repoRow?.openPrs ?? 0),
		queued: Number(queuedRow?.queued ?? 0),
		gatePassed: Number(gatePassedRow?.gatePassed ?? 0),
		blocked: blocked.length,
		highRisk: Number(highRiskRow?.highRisk ?? 0),
		longStalled: Number(longStalledRow?.longStalled ?? 0),
		ciFailingRepos: Number(ciFailingRow?.ciFailingRepos ?? 0),
		rateLimitRemainingPct,
		blockedByResponsibility: ALL_RESPONSIBILITIES.map((responsibility) => ({
			responsibility,
			count: counts.get(responsibility) ?? 0,
		})),
		recent: {
			merged: Number(mergedRow?.merged ?? 0),
			failed: Number(failedRow?.failed ?? 0),
			autoReverted: Number(autoRevertedRow?.autoReverted ?? 0),
		},
	};

	return json(overview);
};
