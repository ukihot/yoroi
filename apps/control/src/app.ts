import { authenticate, type RequestActor } from "./lib/auth.ts";
import { apiError, notFound } from "./lib/http.ts";
import { handleFleetBlocked, handleFleetOverview } from "./routes/fleet.ts";
import { handleMyWork } from "./routes/my-work.ts";
import { handleListRepos, handleRepoDetail } from "./routes/repos.ts";
import { handleQueue } from "./routes/queue.ts";
import { handleCiReliability } from "./routes/ci.ts";
import { handleReviewerLoad } from "./routes/reviewers.ts";
import { handlePolicySummary } from "./routes/policy.ts";
import { handleFeedback, handlePrDetail, handleRecheck } from "./routes/pr.ts";
import { handleHealth } from "./routes/health.ts";
import { handleAudit } from "./routes/audit.ts";
import { handleRole } from "./routes/role.ts";
import { handleWebhook } from "./routes/webhook.ts";
import { handleOutboxDrain, handleReconcile } from "./routes/internal.ts";

export type RouteHandler = (
	req: Request,
	actor: RequestActor,
	params: Record<string, string>,
) => Promise<Response>;

interface Route {
	method: string;
	pattern: URLPattern;
	handler: RouteHandler;
}

// design.md §16 (base table) + §24.2 (dashboard-specific reads), scoped down
// to what yoroi-console's ControlApiPort actually calls — see this repo's
// plan notes for the full endpoint-by-endpoint rationale.
const routes: Route[] = [
	{
		method: "GET",
		pattern: new URLPattern({ pathname: "/api/fleet/overview" }),
		handler: handleFleetOverview,
	},
	{
		method: "GET",
		pattern: new URLPattern({ pathname: "/api/fleet/blocked" }),
		handler: handleFleetBlocked,
	},
	{ method: "GET", pattern: new URLPattern({ pathname: "/api/my-work" }), handler: handleMyWork },
	{ method: "GET", pattern: new URLPattern({ pathname: "/api/repos" }), handler: handleListRepos },
	{
		method: "GET",
		pattern: new URLPattern({ pathname: "/api/repos/:repoId" }),
		handler: handleRepoDetail,
	},
	{ method: "GET", pattern: new URLPattern({ pathname: "/api/queue" }), handler: handleQueue },
	{
		method: "GET",
		pattern: new URLPattern({ pathname: "/api/pr/:repoId/:prNumber" }),
		handler: handlePrDetail,
	},
	{
		method: "POST",
		pattern: new URLPattern({ pathname: "/api/pr/:repoId/:prNumber/recheck" }),
		handler: handleRecheck,
	},
	{
		method: "POST",
		pattern: new URLPattern({ pathname: "/api/pr/:repoId/:prNumber/feedback" }),
		handler: handleFeedback,
	},
	{
		method: "GET",
		pattern: new URLPattern({ pathname: "/api/ci/reliability" }),
		handler: handleCiReliability,
	},
	{
		method: "GET",
		pattern: new URLPattern({ pathname: "/api/reviewers/load" }),
		handler: handleReviewerLoad,
	},
	{
		method: "GET",
		pattern: new URLPattern({ pathname: "/api/policy/drift" }),
		handler: handlePolicySummary,
	},
	{ method: "GET", pattern: new URLPattern({ pathname: "/api/health" }), handler: handleHealth },
	{ method: "GET", pattern: new URLPattern({ pathname: "/api/audit" }), handler: handleAudit },
	{ method: "GET", pattern: new URLPattern({ pathname: "/api/role" }), handler: handleRole },
	// design.md §16: operator-only internal endpoints. MVP stand-in auth: the
	// same console↔control shared bearer token as every /api/* route (see
	// lib/auth.ts's own comment) — real per-actor operator RBAC is
	// design.md §17.4/§24.4 future work, same gap that route already flags.
	{
		method: "POST",
		pattern: new URLPattern({ pathname: "/internal/reconcile" }),
		handler: handleReconcile,
	},
	{
		method: "POST",
		pattern: new URLPattern({ pathname: "/internal/outbox/drain" }),
		handler: handleOutboxDrain,
	},
];

export function createApp(): (req: Request) => Promise<Response> {
	return async function fetch(req: Request): Promise<Response> {
		const url = new URL(req.url);
		if (url.pathname === "/healthz") return new Response("ok");

		// design.md §7.1: GitHub's HMAC signature is this route's own auth —
		// it never goes through the console↔control bearer-token gate below.
		if (url.pathname === "/github/webhook" && req.method === "POST") {
			try {
				return await handleWebhook(req);
			} catch (error) {
				console.error("[yoroi-control] POST /github/webhook failed:", error);
				return new Response("internal error", { status: 500 });
			}
		}

		const auth = authenticate(req);
		if (!auth.ok) return auth.response;

		for (const route of routes) {
			if (route.method !== req.method) continue;
			const match = route.pattern.exec(url);
			if (!match) continue;
			const params = Object.fromEntries(
				Object.entries(match.pathname.groups).filter(([, v]) => v !== undefined),
			) as Record<string, string>;
			try {
				return await route.handler(req, auth.actor, params);
			} catch (error) {
				console.error(`[yoroi-control] ${req.method} ${url.pathname} failed:`, error);
				return apiError(500, {
					code: "INTERNAL_ERROR",
					humanReason: "yoroi-control failed to process this request",
					evidenceLink: null,
					selfServiceAction: null,
					escalationTo: "operator",
				});
			}
		}
		return notFound("route");
	};
}
