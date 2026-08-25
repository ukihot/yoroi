import { mustGetEnv } from "../env.ts";
import { apiError } from "./http.ts";

export interface RequestActor {
	actorStableId: string;
}

export type AuthResult = { ok: true; actor: RequestActor } | { ok: false; response: Response };

/**
 * Service-to-service auth between yoroi-console and yoroi-control. This is a
 * deliberate MVP stand-in for design.md §17.4/§24.4's org SSO/OIDC
 * federation (see doc/design.md §22 and the plan this was built from):
 * yoroi-console has already verified the human session via Better Auth
 * before it ever calls here, so this only needs to confirm the caller is
 * yoroi-console itself (shared bearer token) and trust the actor id it
 * forwards.
 */
export function authenticate(req: Request): AuthResult {
	const expected = mustGetEnv("YOROI_CONTROL_API_TOKEN");
	const header = req.headers.get("authorization") ?? "";
	const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
	if (token !== expected) {
		return {
			ok: false,
			response: apiError(401, {
				code: "UNAUTHORIZED",
				humanReason: "missing or invalid service token",
				evidenceLink: null,
				selfServiceAction: null,
				escalationTo: null,
			}),
		};
	}

	const actorStableId = req.headers.get("x-yoroi-actor-id");
	if (!actorStableId) {
		return {
			ok: false,
			response: apiError(400, {
				code: "MISSING_ACTOR",
				humanReason: "X-Yoroi-Actor-Id header is required",
				evidenceLink: null,
				selfServiceAction: null,
				escalationTo: null,
			}),
		};
	}

	return { ok: true, actor: { actorStableId } };
}
