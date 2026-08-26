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
 * `/healthz` — so it fails fast at startup instead: refuses to boot in a
 * non-production context unless `YOROI_MERGER_DEV=1` is set explicitly for
 * local testing.
 *
 * `DENO_TIMELINE` (not `DENO_DEPLOY_CONTEXT` — design.md §18's illustrative
 * OTel snippet uses that name, but it isn't a real Deno Deploy env var; this
 * was caught by an actual failed production deploy, then confirmed against
 * https://docs.deno.com/deploy/reference/env_vars_and_contexts/) is
 * Production's own signal: its value is exactly `"production"` there,
 * `"git-branch/<branch>"` or `"preview/<revision-id>"` in Development, and
 * unset entirely during the Build context or outside Deno Deploy.
 */
const timeline = Deno.env.get("DENO_TIMELINE") ?? "unknown";
if (timeline !== "production" && Deno.env.get("YOROI_MERGER_DEV") !== "1") {
	throw new Error(
		`yoroi-merger refuses to start on timeline "${timeline}" without YOROI_MERGER_DEV=1 (design.md §17.3)`,
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
