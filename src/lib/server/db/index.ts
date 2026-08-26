import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

/**
 * Deno Deploy's Build context has no runtime secrets (only Production
 * context does — design.md §17.3's context separation), but SvelteKit's
 * build step imports this module anyway while introspecting the compiled
 * server bundle (hooks.server.ts -> $lib/server/auth -> here). An eager
 * `if (!env.DATABASE_URL) throw` here used to crash the *build itself*, not
 * just a misconfigured deploy — see the "yoroi-console build error" note
 * this repo's README once needed. `postgres()` connects lazily (no TCP
 * until the first query) regardless of the URL given, so falling back to a
 * placeholder here is harmless unless something actually queries `db`
 * before `DATABASE_URL` is configured for real, which then fails with a
 * real (if less friendly) connection error at that later point — still
 * fail-closed, just not fail-closed-at-import-time.
 */
if (!env.DATABASE_URL) {
	console.warn(
		'[yoroi-console] DATABASE_URL is not set — using a placeholder until a real request needs it'
	);
}

const client = postgres(env.DATABASE_URL || 'postgres://unset:unset@unset/unset');

export const db = drizzle(client, { schema });
