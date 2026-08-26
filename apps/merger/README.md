# yoroi-merger

The one Deno Deploy app with GitHub merge authority. Physically separate from `yoroi-control`
(separate app, separate GitHub App, separate deploy permissions, separate Production-context
secrets) so that compromising `yoroi-control` alone can never merge anything — see
[doc/design.md](../../doc/design.md) §2.2, §12, §17.3, §19.3's trust-boundary diagram, and DP-07/
SEC-030.

**Scope**: implements design.md §12.3's merge handler in full — OIDC caller verification, Decision
Envelope schema + signature + expiry verification, branch-lease fencing-token equality (AT-34), an
authoritative GitHub re-fetch + revalidation immediately before merging, and merge execution with a
hash-chained `decision_event` audit row. It accepts requests only from `yoroi-control`
(`apps/control/src/worker/serial-scheduler.ts`), never directly from GitHub or the console.

**MVP gap, documented not hidden**: `src/oidc.ts` verifies a shared secret token rather than a real
Deno Deploy-issued OIDC identity token — this session had no live Deno Deploy project to confirm
that platform API's exact shape against. The pure claims-comparison logic it will eventually feed
(`checkOidcClaims`, `packages/domain/src/identity-issuer.ts`) is already built and unit-tested
independently of the token format, so swapping in a real verifier later changes only how `claims`
gets constructed in `src/oidc.ts`, not `src/handler.ts` or anything downstream.

## Running locally

```sh
cp .env.example .env   # then fill in DATABASE_URL / MERGER_GITHUB_APP_* / YOROI_MERGER_SHARED_TOKEN
deno task dev            # serves on :8788 (PORT env var); requires YOROI_MERGER_DEV=1 outside production
```

`YOROI_MERGER_SHARED_TOKEN` must match the value `apps/control`'s `.env` uses for the same variable
(see that app's README's "Calling yoroi-merger" section) — it's both the OIDC-stand-in bearer token
and the HMAC key that verifies the Decision Envelope's signature.

```sh
deno task test
```

All tests use fake `MergerContext`/`GitHubAdapter` implementations (`src/handler.test.ts`,
`src/oidc.test.ts`) — no live Postgres or GitHub connection needed. `getCurrentFencingToken`/
`appendDecisionEvent` are injected as plain functions on `MergerContext` specifically so this app's
single most safety-critical code path (the AT-34 stale-fencing-token rejection, and every other
rejection branch in the 5-step sequence) is fully exercised without needing a live database — see
`src/handler.ts`'s top comment.

## Database

Connects to the same logical PostgreSQL database as `yoroi-control` (`@yoroi/postgres`), but should
use its own minimally-privileged DB role in production (design.md §17.5) — never the same credential
`yoroi-control` connects with. It only ever reads `branch_coordinator` (fencing token) and appends
to `decision_event`; it has no reason to touch any dashboard/read-model table.

## Deploying

Deploy this directory (`apps/merger`) as its **own** Deno Deploy app — never combined with
`apps/control` or `apps/console`. Set `DATABASE_URL`, `MERGER_GITHUB_APP_ID`,
`MERGER_GITHUB_APP_PRIVATE_KEY`, and `YOROI_MERGER_SHARED_TOKEN` as **Production-context-only**
secrets (design.md §17.3: none of these may exist in a Development/branch-preview context —
`main.ts` refuses to boot outside `DENO_DEPLOY_CONTEXT=production` unless `YOROI_MERGER_DEV=1` is
explicitly set, which itself must never be set in production). Register a separate Merger GitHub App
with merge-only minimal permissions (design.md §13.10) — never reuse `yoroi-control`'s Observer App
credentials here.
