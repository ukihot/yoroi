import { asc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { repository } from "@yoroi/postgres";
import { badRequest, json, notFound } from "../lib/http.ts";
import type { RouteHandler } from "../app.ts";
import type { RepoDetail, RepoSummary } from "../domain/types.ts";

export const handleListRepos: RouteHandler = async () => {
	const rows = await db.select().from(repository).orderBy(asc(repository.name));
	const summaries: RepoSummary[] = rows.map((r) => ({
		repoId: r.repoId,
		name: r.name,
		mode: r.mode,
		status: r.status,
		openPrs: r.openPrs,
		gatePassRatePct: r.gatePassRatePct,
		ciSuccessRatePct: r.ciSuccessRatePct,
		p50LeadTimeMinutes: r.p50LeadTimeMinutes,
	}));
	return json(summaries);
};

export const handleRepoDetail: RouteHandler = async (_req, _actor, params) => {
	const repoId = params.repoId;
	if (!repoId) return badRequest("repoId is required");
	const [row] = await db.select().from(repository).where(eq(repository.repoId, repoId)).limit(1);
	if (!row) return notFound(`repository ${repoId}`);

	const detail: RepoDetail = {
		repoId: row.repoId,
		name: row.name,
		mode: row.mode,
		status: row.status,
		openPrs: row.openPrs,
		gatePassRatePct: row.gatePassRatePct,
		ciSuccessRatePct: row.ciSuccessRatePct,
		p50LeadTimeMinutes: row.p50LeadTimeMinutes,
		targetBranch: row.targetBranch,
		policyVersion: row.policyVersion,
		rulesetConsistent: row.rulesetConsistent,
		installationOk: row.installationOk,
		lastWebhookAt: (row.lastWebhookAt ?? row.updatedAt).toISOString(),
		lastReconcileAt: (row.lastReconcileAt ?? row.updatedAt).toISOString(),
		metrics: row.metrics,
		flakyRatePct: row.flakyRatePct,
		rebuildRatePct: row.rebuildRatePct,
		batchSplitRatePct: row.batchSplitRatePct,
		autoRevertRatePct: row.autoRevertRatePct,
	};
	return json(detail);
};
