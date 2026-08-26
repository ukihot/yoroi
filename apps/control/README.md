# yoroi-control

The Deno Deploy app that ingests GitHub webhooks, runs the real Policy Engine/state machine/Serial
Scheduler, serves `yoroi-console`'s read APIs (fleet overview, my work, repos, merge queue, PR
detail, health, audit), and handles `/yoroi` slash commands. See
[doc/design.md](../../doc/design.md) (§2, §5–9, §11, §14–17, §23–24) for the full system design.

**Scope**: this app implements design.md's Phase 0–3 detailed-design scope — webhook ingestion (§7),
the real Policy Engine/state machine (§5, §9), approval continuity/carry-forward (§8), the Serial
merge scheduler and Branch Coordinator lease/fencing (§10–11), and slash commands (§15). It submits
signed Decision Envelopes to the separate `yoroi-merger` app (`../merger`) rather than merging
directly — see that app's README for the merge-execution side of the trust boundary. Deliberately
out of scope for this pass (see the repo's plan notes / `doc/design.md` §21's phase table):
Speculative/Batch train orchestration (Phase 4 — the pure building blocks exist as dormant code in
`packages/domain/src/scheduler/`, unwired), Terraform/Org Governance (Phase 5), and cross-repo
DAG/auto-revert/external KMS (Phase 6). A few narrower MVP gaps are flagged inline where they matter
— search this app's source for "MVP" comments (e.g. no real GitHub collaborator- permission lookup
yet for slash-command authorization, no dynamic expected-check-plan builder).

## Running locally

```sh
cp .env.example .env   # then fill in DATABASE_URL / YOROI_CONTROL_API_TOKEN / GITHUB_* / YOROI_MERGER_*
deno task migrate        # applies packages/postgres/src/migrations/*.sql (shared schema, see below)
deno task seed             # sample dashboard data (set YOROI_SEED_ACTOR_ID to your Better Auth user id first)
deno task dev                # serves on :8787 (PORT env var)
```

Point a real GitHub App's webhook at `http://<host>/github/webhook` (raw body + HMAC-SHA256 per
`GITHUB_WEBHOOK_SECRET`) to exercise the real ingestion→evaluation→merge pipeline end to end;
without one, `deno task seed`'s fixture rows still let the console's read screens render against
real SQL.

Unit tests (pure/env-driven logic — route auth, event-fact parsing, role-vocabulary mapping, webhook
helper functions — via Deno's own `@std/testing/mock` spies/stubs and plain `Deno.test` rather than
a live database; see each `*.test.ts` file's top comment for exactly what is and isn't covered this
way — DB-touching orchestration in `src/worker/` is covered by `deno check` + manual verification
against a real database, the same convention this app's original routes already used):

```sh
deno task test
```

Point the console at it by setting, in the **root** `.env`:

```
YOROI_CONTROL_URL="http://localhost:8787"
YOROI_CONTROL_API_TOKEN="<same value as this app's .env>"
```

## Database

Uses PostgreSQL via Drizzle (`drizzle-orm/postgres-js`). Schema, migrations, and the DB client all
live in `packages/postgres` now (`@yoroi/postgres`'s `createDb`/`runMigrations`/table exports) —
this app has no schema of its own; `src/db/client.ts` and `src/db/migrate.ts` are thin wrappers. In
production, point `DATABASE_URL` at Deno Deploy's built-in Postgres database (provisioned per app in
the Deno Deploy dashboard, set as a Production-context secret) rather than a self-hosted instance —
see doc/design.md §22.

This app's database is private to it and `yoroi-merger`; `yoroi-console` never connects to Postgres
directly (design.md §2.2) — it only calls this app's HTTP API. `packages/postgres/src/schema.ts`'s
own top comment explains the two table families it holds (dashboard/read-model projections vs.
event-sourced engine tables) and why they now live together.

## Auth

Every `/api/*` and `/internal/*` route requires `Authorization: Bearer <YOROI_CONTROL_API_TOKEN>`
plus an `X-Yoroi-Actor-Id` header — a deliberate MVP stand-in for design.md §17.4/§24.4's full org
SSO/OIDC federation and per-actor operator RBAC (see `src/lib/auth.ts`). `POST /github/webhook` is
the one route that bypasses this gate entirely: GitHub's own HMAC signature is its auth.

## Calling yoroi-merger

`src/worker/serial-scheduler.ts` signs a Decision Envelope (`@yoroi/evidence`) and calls
`YOROI_MERGER_URL/internal/merge` with an identity token from `src/lib/identity-issuer.ts`. That
file's comment explains the MVP shared-secret stand-in for real Deno Deploy OIDC — set
`YOROI_MERGER_SHARED_TOKEN` to the same value `yoroi-merger` is configured with.

## Deploying

Deploy this directory (`apps/control`) as its own Deno Deploy app, separate from `yoroi-merger` and
the console's SvelteKit deployment. Set `DATABASE_URL`, `YOROI_CONTROL_API_TOKEN`,
`YOROI_DEFAULT_ROLE`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`,
`YOROI_MERGER_URL`, `YOROI_MERGER_SHARED_TOKEN`, and (optionally) `WEBHOOK_PAYLOAD_ENCRYPTION_KEY`
as Production-context secrets, then run `deno task migrate` against the production database before
pointing GitHub's webhook at it. Register the GitHub App's webhook events per design.md §13.10's
Observer App permission table before going live.
