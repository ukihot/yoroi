import type { IdentityIssuer } from "@yoroi/domain";
import { mustGetEnv } from "../env.ts";

/**
 * design.md §17.4/SEC-034: apps/control needs to prove its identity to
 * apps/merger when submitting a Decision Envelope. The doc's target
 * mechanism is Deno Deploy's own OIDC identity-token minting — but this
 * session has no live Deno Deploy project to confirm that platform API's
 * exact shape against, so this ships the same kind of MVP stand-in
 * `apps/control/src/lib/auth.ts` already uses for console→control auth: a
 * shared secret read from a Production-context-only env var, symmetric with
 * `apps/merger/src/oidc.ts`'s interim verifier. Swapping this for a real
 * `DenoDeployIdentityIssuer` later is a drop-in replacement — the
 * `IdentityIssuer` port (packages/domain) and `apps/merger`'s `OidcVerifier`
 * port don't change, only what token gets minted/checked.
 */
export function createEnvTokenIdentityIssuer(): IdentityIssuer {
	return {
		getOidcToken(_audience: string): Promise<string> {
			return Promise.resolve(mustGetEnv("YOROI_MERGER_SHARED_TOKEN"));
		},
	};
}
