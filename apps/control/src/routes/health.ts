import { asc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { fleetHealthSnapshot } from "../db/schema.ts";
import { json } from "../lib/http.ts";
import type { RouteHandler } from "../app.ts";
import type { HealthEntry } from "../domain/types.ts";

export const handleHealth: RouteHandler = async () => {
	const rows = await db.select().from(fleetHealthSnapshot).orderBy(
		asc(fleetHealthSnapshot.component),
	);
	const entries: HealthEntry[] = rows.map((r) => ({
		component: r.component,
		status: r.status,
		reason: r.reason ?? "—",
		updatedAt: r.observedAt.toISOString(),
	}));
	return json(entries);
};
