import { getEnv } from "../env.ts";
import { json } from "../lib/http.ts";
import type { RouteHandler } from "../app.ts";
import type { Role } from "../domain/types.ts";

const KNOWN_ROLES: readonly Role[] = [
	"reviewer",
	"scope_approver",
	"security_approver",
	"data_approver",
	"infra_approver",
	"governor",
	"operator",
	"maintainer",
	"developer",
];

/**
 * MVP: no real ownership-graph/org-membership source yet (design.md defers
 * this — see doc/design.md §21/§22 and src/db/schema.ts's notes on
 * pr_reviewer_assignment). Mirrors the console app's own former
 * `roles.ts` env-var fallback, now served from the backend so the console
 * doesn't need to know how role resolution eventually gets implemented.
 */
export const handleRole: RouteHandler = (_req, _actor, _params) => {
	const configured = getEnv("YOROI_DEFAULT_ROLE", "operator") as Role;
	const role = KNOWN_ROLES.includes(configured) ? configured : "operator";
	return Promise.resolve(json({ role }));
};
