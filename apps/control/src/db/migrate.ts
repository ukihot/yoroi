import { runMigrations } from "@yoroi/postgres";
import { mustGetEnv } from "../env.ts";

/**
 * Thin wrapper so `deno task migrate` keeps working from apps/control after
 * the schema/migration SQL moved to packages/postgres (design.md §3.3's
 * `packages/postgres/src/migrations/run.ts` task convention) — see
 * apps/control/README.md.
 */
if (import.meta.main) {
	await runMigrations(mustGetEnv("DATABASE_URL"));
}
