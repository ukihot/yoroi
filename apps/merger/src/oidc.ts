import { checkOidcClaims } from "@yoroi/domain";
import type {
	OidcClaims,
	OidcVerificationError,
	OidcVerifier,
	OidcVerifyExpectation,
} from "@yoroi/domain";
import { err, type Result } from "@yoroi/domain";

/**
 * design.md §17.4/SEC-034. The real target mechanism is verifying a Deno
 * Deploy-issued OIDC identity token's signature + `aud`/`iss`/`exp`/org/app/
 * context claims. This session has no live Deno Deploy project to confirm
 * that platform API's exact shape against, so this ships the same MVP
 * shared-secret stand-in `apps/control/src/lib/identity-issuer.ts` uses on
 * the issuing side — see that file's comment. Swapping in a real
 * `DenoDeployOidcVerifier` later only changes how `claims` gets built below;
 * `checkOidcClaims` (packages/domain, already unit-tested independently of
 * any token format) is the part that doesn't change.
 */

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

export function createEnvTokenOidcVerifier(expectedToken: string): OidcVerifier {
	return {
		verify(
			token: string | null,
			expected: OidcVerifyExpectation,
		): Promise<Result<OidcClaims, OidcVerificationError>> {
			if (!token) return Promise.resolve(err({ kind: "MISSING_TOKEN" }));
			if (!timingSafeEqual(token, expectedToken)) {
				return Promise.resolve(err({ kind: "MALFORMED_TOKEN" }));
			}
			// Shared-token mode has no real claims to extract — the token's
			// validity *is* the proof, so the synthesized claims trivially match
			// `expected`. checkOidcClaims still runs (rather than short-circuiting
			// straight to `ok`) so the expiry/audience/app/context comparison
			// logic is exercised uniformly regardless of which verifier is wired.
			const claims: OidcClaims = {
				audience: expected.audience,
				issuer: "yoroi-control:shared-token-mode",
				expiresAt: new Date(Date.now() + 60_000),
				org: "shared-token-mode",
				app: expected.allowedCallerApp,
				context: expected.requiredContext,
			};
			return Promise.resolve(checkOidcClaims(claims, expected));
		},
	};
}

export function oidcErrorToHttpBody(
	error: OidcVerificationError,
): { code: string; humanReason: string } {
	switch (error.kind) {
		case "MISSING_TOKEN":
			return { code: "OIDC_MISSING_TOKEN", humanReason: "no identity token was presented" };
		case "MALFORMED_TOKEN":
			return { code: "OIDC_MALFORMED_TOKEN", humanReason: "identity token could not be verified" };
		case "AUDIENCE_MISMATCH":
			return {
				code: "OIDC_AUDIENCE_MISMATCH",
				humanReason: "identity token audience does not match",
			};
		case "EXPIRED":
			return { code: "OIDC_EXPIRED", humanReason: "identity token has expired" };
		case "WRONG_APP":
			return {
				code: "OIDC_WRONG_APP",
				humanReason: "caller app is not authorized to invoke merge",
			};
		case "WRONG_CONTEXT":
			return {
				code: "OIDC_WRONG_CONTEXT",
				humanReason: "identity token was not issued for a production context",
			};
	}
}
