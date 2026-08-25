# yoroi-control

The Deno Deploy backend `yoroi-console` calls for its read APIs (fleet overview, my work, repos,
merge queue, PR detail, health, audit) and the `recheck` / `feedback` commands. See
[doc/design.md](../../doc/design.md) (§2, §6, §15–17, §23–24) for the full system design, and the
repo's plan notes for exactly which parts of that design this app implements vs. defers.

**Scope**: this app is the read/command API surface the console needs today. It does **not**
implement GitHub webhook ingestion (§7), the real Policy Engine / state machine (§5, §9), Branch
Coordinator or `yoroi-merger` (§10, §12), or the GitHub API adapter (§13) — those need a live GitHub
App and are future work per design.md §21's phased roadmap. `pr_decision_snapshot`
(gates/checks/conclusion/reason graph) is a precomputed JSON projection seeded by `src/db/seed.ts`,
standing in for what a real evaluator would produce.

## Running locally

```sh
cp .env.example .env   # then edit DATABASE_URL / YOROI_CONTROL_API_TOKEN
deno task migrate       # applies src/db/migrations/*.sql
deno task seed           # sample data (set YOROI_SEED_ACTOR_ID to your Better Auth user id first)
deno task dev              # serves on :8787 (PORT env var)
```

Unit tests (route handlers' pure/env-driven logic, using Deno's own
`@std/testing/mock` spies/stubs rather than a live database — see each
`*.test.ts` file's top comment for what is and isn't covered this way):

```sh
deno task test
```

Point the console at it by setting, in the **root** `.env`:

```
YOROI_CONTROL_URL="http://localhost:8787"
YOROI_CONTROL_API_TOKEN="<same value as this app's .env>"
```

## Database

Uses PostgreSQL via Drizzle (`drizzle-orm/postgres-js`, matching the driver the console app already
uses for Better Auth). In production, point `DATABASE_URL` at Deno Deploy's built-in Postgres
database (provisioned per app in the Deno Deploy dashboard, set as a Production-context secret)
rather than a self-hosted instance — see doc/design.md §22.

This app's database is private to it; `yoroi-console` never connects to Postgres directly (design.md
§2.2) — it only calls this app's HTTP API.

Migrations are hand-written SQL in `src/db/migrations/`, applied in order by `src/db/migrate.ts`
(tracked in an `applied_migration` table). `drizzle-kit` isn't used here — it's a Node CLI already
wired to the console app's own (unrelated) database via the root `drizzle.config.ts`.

## Auth

Every `/api/*` route requires `Authorization: Bearer <YOROI_CONTROL_API_TOKEN>` plus an
`X-Yoroi-Actor-Id` header. This is a deliberate MVP stand-in for design.md §17.4/§24.4's full org
SSO/OIDC federation between the two apps — see `src/lib/auth.ts`.

## Deploying

Deploy this directory (`apps/control`) as its own Deno Deploy app, separate from the console's
SvelteKit deployment. Set `DATABASE_URL`, `YOROI_CONTROL_API_TOKEN`, and `YOROI_DEFAULT_ROLE` as
Production-context secrets, then run `deno task migrate` and `deno task seed` (or a real data
pipeline, once one exists) against the production database before pointing traffic at it.
