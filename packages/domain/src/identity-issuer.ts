import { err, ok, type Result } from "./result.ts";

/**
 * design.md §17.4. `apps/control` holds an `IdentityIssuer` implementation
 * (Deno Deploy OIDC) to mint tokens for calling `yoroi-merger`;
 * `apps/merger` holds an `OidcVerifier` implementation checking those tokens'
 * `aud`/`iss`/`exp`/org/app/context claims (SEC-034). Concrete platform
 * adapters live in each app (`apps/control/src/lib/identity-issuer.ts`,
 * `apps/merger/src/oidc.ts`) — this file only defines the port, matching
 * design.md §1.5/§3.2's Ports-at-the-Edges rule that `domain` stays
 * dependency-free and I/O-free.
 */

export interface IdentityIssuer {
	getOidcToken(audience: string): Promise<string>;
}

export interface OidcClaims {
	readonly audience: string;
	readonly issuer: string;
	readonly expiresAt: Date;
	readonly org: string;
	readonly app: string;
	readonly context: string;
}

export type OidcVerificationError =
	| { readonly kind: "MISSING_TOKEN" }
	| { readonly kind: "MALFORMED_TOKEN" }
	| { readonly kind: "AUDIENCE_MISMATCH"; readonly expected: string; readonly actual: string }
	| { readonly kind: "EXPIRED"; readonly expiredAt: Date }
	| { readonly kind: "WRONG_APP"; readonly expected: string; readonly actual: string }
	| { readonly kind: "WRONG_CONTEXT"; readonly expected: string; readonly actual: string };

export interface OidcVerifyExpectation {
	readonly audience: string;
	readonly allowedCallerApp: string;
	readonly requiredContext: "production";
}

export interface OidcVerifier {
	verify(
		token: string | null,
		expected: OidcVerifyExpectation,
	): Promise<Result<OidcClaims, OidcVerificationError>>;
}

/**
 * The pure claim-comparison logic (SEC-034), factored out of any concrete
 * token-parsing implementation so it's unit-testable without a real Deno
 * Deploy OIDC token. A concrete `OidcVerifier` (e.g.
 * `apps/merger/src/oidc.ts`'s `DenoDeployOidcVerifier`) parses/validates the
 * token's signature/structure first, then calls this to check the claims it
 * extracted.
 */
export function checkOidcClaims(
	claims: OidcClaims,
	expected: OidcVerifyExpectation,
	now: Date = new Date(),
): Result<OidcClaims, OidcVerificationError> {
	if (claims.expiresAt.getTime() <= now.getTime()) {
		return err({ kind: "EXPIRED", expiredAt: claims.expiresAt });
	}
	if (claims.audience !== expected.audience) {
		return err({ kind: "AUDIENCE_MISMATCH", expected: expected.audience, actual: claims.audience });
	}
	if (claims.app !== expected.allowedCallerApp) {
		return err({ kind: "WRONG_APP", expected: expected.allowedCallerApp, actual: claims.app });
	}
	if (claims.context !== expected.requiredContext) {
		return err({
			kind: "WRONG_CONTEXT",
			expected: expected.requiredContext,
			actual: claims.context,
		});
	}
	return ok(claims);
}
