import { desc, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { decisionEvent, repository } from "@yoroi/postgres";
import { json } from "../lib/http.ts";
import type { RouteHandler } from "../app.ts";
import type { AuditEntry } from "../domain/types.ts";

export const handleAudit: RouteHandler = async (req) => {
	const q = (new URL(req.url).searchParams.get("q") ?? "").trim().toLowerCase();

	const rows = await db
		.select({
			occurredAt: decisionEvent.occurredAt,
			actor: decisionEvent.actorStableId,
			operation: decisionEvent.operation,
			repoName: repository.name,
			prNumber: decisionEvent.prNumber,
			result: decisionEvent.result,
		})
		.from(decisionEvent)
		.innerJoin(repository, eq(repository.repoId, decisionEvent.repoId))
		.orderBy(desc(decisionEvent.occurredAt))
		.limit(200);

	const entries: AuditEntry[] = rows
		.map((r) => ({
			occurredAt: r.occurredAt.toISOString(),
			actor: r.actor ?? "yoroi",
			operation: r.operation,
			repo: r.repoName,
			prNumber: r.prNumber,
			result: r.result,
		}))
		.filter(
			(e) =>
				!q ||
				[e.actor, e.operation, e.repo, e.result, String(e.prNumber ?? "")].some((field) =>
					field.toLowerCase().includes(q)
				),
		);

	return json(entries);
};
