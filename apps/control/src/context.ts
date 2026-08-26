import type { GitHubAdapter } from "@yoroi/github";
import type { Db } from "@yoroi/postgres";
import type { IdentityIssuer } from "@yoroi/domain";
import { db } from "./db/client.ts";
import { getGitHubAdapter } from "./lib/github-client.ts";
import { createEnvTokenIdentityIssuer } from "./lib/identity-issuer.ts";
import { getEnv, mustGetEnv } from "./env.ts";

/** Everything the webhook route, outbox worker, serial scheduler, and slash
 * commands need. Built lazily (see `getGitHubAdapter`'s comment) so
 * `deno task test`/`deno task check` never require live credentials —
 * only actually invoking a handler that calls `getControlContext()` does. */
export interface ControlContext {
	readonly db: Db;
	readonly github: GitHubAdapter;
	readonly identityIssuer: IdentityIssuer;
	readonly mergerBaseUrl: string;
	readonly instanceId: string;
}

let cached: ControlContext | null = null;

export function getControlContext(): ControlContext {
	if (!cached) {
		cached = {
			db,
			github: getGitHubAdapter(),
			identityIssuer: createEnvTokenIdentityIssuer(),
			mergerBaseUrl: mustGetEnv("YOROI_MERGER_URL"),
			instanceId: getEnv("DENO_DEPLOYMENT_ID", crypto.randomUUID()),
		};
	}
	return cached;
}
