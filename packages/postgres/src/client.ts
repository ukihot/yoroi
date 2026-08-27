import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

/** Lazy connect (design.md §17.5: scale-to-zero instances shouldn't pay a
 * connection cost at module load). `postgres()` itself doesn't open a
 * connection until the first query runs, so this is safe to call at
 * module-eval time. */
export function createDb(databaseUrl: string) {
	const queryClient = postgres(databaseUrl);
	return drizzle(queryClient, { schema });
}

export type Db = ReturnType<typeof createDb>;
