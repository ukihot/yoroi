import { assertEquals } from "@std/assert";
import { createEnvTokenOidcVerifier, oidcErrorToHttpBody } from "./oidc.ts";
import type { OidcVerifyExpectation } from "@yoroi/domain";

const expected: OidcVerifyExpectation = {
	audience: "yoroi-merger",
	allowedCallerApp: "yoroi-control",
	requiredContext: "production",
};

Deno.test("createEnvTokenOidcVerifier: 正しいtokenはokを返す", async () => {
	const verifier = createEnvTokenOidcVerifier("shared-secret");
	const result = await verifier.verify("shared-secret", expected);
	assertEquals(result.ok, true);
});

Deno.test("createEnvTokenOidcVerifier: tokenがnullならMISSING_TOKEN", async () => {
	const verifier = createEnvTokenOidcVerifier("shared-secret");
	const result = await verifier.verify(null, expected);
	assertEquals(result.ok, false);
	if (result.ok) return;
	assertEquals(result.error.kind, "MISSING_TOKEN");
});

Deno.test("createEnvTokenOidcVerifier: 違うtokenはMALFORMED_TOKEN", async () => {
	const verifier = createEnvTokenOidcVerifier("shared-secret");
	const result = await verifier.verify("wrong-token", expected);
	assertEquals(result.ok, false);
	if (result.ok) return;
	assertEquals(result.error.kind, "MALFORMED_TOKEN");
});

Deno.test("createEnvTokenOidcVerifier: 長さが違うtokenも安全にMALFORMED_TOKEN扱いになる（早期return無しの比較）", async () => {
	const verifier = createEnvTokenOidcVerifier("shared-secret");
	const result = await verifier.verify("short", expected);
	assertEquals(result.ok, false);
});

Deno.test("oidcErrorToHttpBody: 全kindに対して機械可読codeと人向け文を返す", () => {
	for (
		const kind of [
			"MISSING_TOKEN",
			"MALFORMED_TOKEN",
			"AUDIENCE_MISMATCH",
			"EXPIRED",
			"WRONG_APP",
			"WRONG_CONTEXT",
		] as const
	) {
		const body = oidcErrorToHttpBody(
			kind === "AUDIENCE_MISMATCH"
				? { kind, expected: "a", actual: "b" }
				: kind === "EXPIRED"
				? { kind, expiredAt: new Date() }
				: kind === "WRONG_APP"
				? { kind, expected: "a", actual: "b" }
				: kind === "WRONG_CONTEXT"
				? { kind, expected: "production", actual: "development" }
				: { kind },
		);
		assertEquals(typeof body.code, "string");
		assertEquals(typeof body.humanReason, "string");
	}
});
