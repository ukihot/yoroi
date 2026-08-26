import { createDb } from "@yoroi/postgres";
import { mustGetEnv } from "../env.ts";

/**
 * design.md §2.2/§17.5. apps/control no longer owns its own private schema —
 * it points at packages/postgres's shared schema (the engine + dashboard
 * projection tables), which is now the single source of truth. See
 * packages/postgres/src/schema.ts's top comment and apps/control/README.md
 * for the history of why these were ever two separate schemas.
 */
export const db = createDb(mustGetEnv("DATABASE_URL"));
