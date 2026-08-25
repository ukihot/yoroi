import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { mustGetEnv } from "../env.ts";
import * as schema from "./schema.ts";

const queryClient = postgres(mustGetEnv("DATABASE_URL"));

export const db = drizzle(queryClient, { schema });
