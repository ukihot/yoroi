import { createOctokitAdapter } from "@yoroi/github";
import { appendDecisionEvent, createDb, getCurrentFencingToken } from "@yoroi/postgres";
import { importHmacEnvelopeKey } from "@yoroi/evidence";
import { handleMergeRequest, type MergerContext } from "./src/handler.ts";
import { createEnvTokenOidcVerifier } from "./src/oidc.ts";

function mustGetEnv(name: string): string {
	const value = Deno.env.get(name);
	if (!value) throw new Error(`${name} is not set`);
	return value;
}

/**
 * design.md §17.3: yoroi-merger's Production-context secrets (Merger App
 * key, envelope verify key) must never be reachable from a Development/
 * branch-preview context. Unlike `apps/control`'s lazily-built context
 * (kept lazy so local dev/testing works without live credentials — see
 * that app's `src/context.ts`), this app's *entire* purpose requires those
 * credentials — there's nothing useful to serve without them besides
 * `/healthz` — so it fails fast at startup instead.
 *
 * This used to try auto-detecting "am I in Deno Deploy's Production
 * context" from a platform-provided env var — first a name invented for
 * design.md's illustrative OTel snippet (`DENO_DEPLOY_CONTEXT`), then
 * `DENO_TIMELINE` per Deno's own docs
 * (https://docs.deno.com/deploy/reference/env_vars_and_contexts/) — and
 * *both* failed against an actual production deploy (the env var read back
 * as unset either way). Rather than guess a third platform-internal name
 * this session can't directly verify, the signal is now something fully
 * within the operator's own control: an explicit `YOROI_MERGER_PRODUCTION=1`
 * flag, set *only* as a Production-context secret in the Deno Deploy
 * dashboard — never in Development. This is at least as safe as the
 * platform-detection approach (design.md §17.3's actual requirement is that
 * Production secrets never reach a non-production deployment, which this
 * flag is itself one of), and doesn't depend on correctly naming a Deno
 * Deploy internal.
 */
if (Deno.env.get("YOROI_MERGER_PRODUCTION") !== "1" && Deno.env.get("YOROI_MERGER_DEV") !== "1") {
	throw new Error(
		"yoroi-merger refuses to start without YOROI_MERGER_PRODUCTION=1 (set only in the Production " +
			"context's secrets) or YOROI_MERGER_DEV=1 (local testing only) — design.md §17.3",
	);
}

const db = createDb(mustGetEnv("DATABASE_URL"));

const ctx: MergerContext = {
	github: createOctokitAdapter(
		mustGetEnv("MERGER_GITHUB_APP_ID"),
		mustGetEnv("MERGER_GITHUB_APP_PRIVATE_KEY"),
	),
	// MVP shared-token mode (src/oidc.ts's comment) — both the verifier and
	// the envelope's HMAC key are derived from the same shared secret as
	// apps/control's identity-issuer.ts issues.
	oidcVerifier: createEnvTokenOidcVerifier(mustGetEnv("YOROI_MERGER_SHARED_TOKEN")),
	envelopeVerifyKey: await importHmacEnvelopeKey(mustGetEnv("YOROI_MERGER_SHARED_TOKEN")),
	getCurrentFencingToken: (key) => getCurrentFencingToken(db, key),
	appendDecisionEvent: (input) => appendDecisionEvent(db, input),
};

const port = Number(Deno.env.get("PORT") ?? "8788");

Deno.serve({ port }, async (req) => {
	const url = new URL(req.url);
	if (url.pathname === "/healthz") return new Response("ok");
	if (url.pathname === "/internal/merge" && req.method === "POST") {
		try {
			return await handleMergeRequest(req, ctx);
		} catch (error) {
			console.error("[yoroi-merger] POST /internal/merge failed:", error);
			return new Response("internal error", { status: 500 });
		}
	}
	return new Response("not found", { status: 404 });
});
