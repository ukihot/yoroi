import { assertEquals } from "@std/assert";
import { type DecisionEnvelope, DecisionEnvelopeSchema, isExpired } from "./envelope.ts";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const DIGEST = "c".repeat(64);

function validEnvelope(overrides: Partial<DecisionEnvelope> = {}): DecisionEnvelope {
	return {
		operationId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
		installationId: 1,
		repositoryId: 2,
		owner: "acme",
		repoName: "widgets",
		pullRequestNumber: 3,
		headSha: SHA_A,
		baseSha: SHA_B,
		baseRef: "main",
		dependencyShas: [SHA_A],
		candidateSha: SHA_A,
		scopeReviewProofs: {
			frontend: { changeDigest: DIGEST, resultDigest: DIGEST, contextProofDigest: DIGEST },
		},
		policyDigest: DIGEST,
		approvalDigest: DIGEST,
		checkPlanDigest: DIGEST,
		evidenceDigest: DIGEST,
		fencingToken: "1",
		denoRevisionId: "rev-1",
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
		...overrides,
	};
}

Deno.test("DecisionEnvelopeSchema: design.md §12.1準拠の正しいenvelopeはparseできる", () => {
	const result = DecisionEnvelopeSchema.safeParse(validEnvelope());
	assertEquals(result.success, true);
});

Deno.test("DecisionEnvelopeSchema: operationIdはULIDでなければ拒否される（UUIDは不可）", () => {
	const withUuid = validEnvelope({ operationId: "550e8400-e29b-41d4-a716-446655440000" });
	assertEquals(DecisionEnvelopeSchema.safeParse(withUuid).success, false);
});

Deno.test("DecisionEnvelopeSchema: SHAは40桁16進文字列でなければ拒否される", () => {
	assertEquals(
		DecisionEnvelopeSchema.safeParse(validEnvelope({ headSha: "not-a-sha" })).success,
		false,
	);
	assertEquals(
		DecisionEnvelopeSchema.safeParse(validEnvelope({ headSha: SHA_A.slice(0, 39) })).success,
		false,
	);
});

Deno.test("DecisionEnvelopeSchema: digestは64桁16進文字列でなければ拒否される", () => {
	assertEquals(
		DecisionEnvelopeSchema.safeParse(validEnvelope({ policyDigest: "short" })).success,
		false,
	);
});

Deno.test("DecisionEnvelopeSchema: fencingTokenは非負整数文字列でなければ拒否される", () => {
	assertEquals(
		DecisionEnvelopeSchema.safeParse(validEnvelope({ fencingToken: "-1" })).success,
		false,
	);
	assertEquals(
		DecisionEnvelopeSchema.safeParse(validEnvelope({ fencingToken: "01" })).success,
		false,
	);
	assertEquals(
		DecisionEnvelopeSchema.safeParse(validEnvelope({ fencingToken: "0" })).success,
		true,
	);
});

Deno.test("DecisionEnvelopeSchema: 未知フィールドは拒否される (.strict())", () => {
	const withExtra = { ...validEnvelope(), extra: "x" };
	assertEquals(DecisionEnvelopeSchema.safeParse(withExtra).success, false);
});

Deno.test("isExpired: expiresAtが未来なら期限切れではない", () => {
	assertEquals(
		isExpired(validEnvelope({ expiresAt: new Date(Date.now() + 60_000).toISOString() })),
		false,
	);
});

Deno.test("isExpired: expiresAtが過去なら期限切れ (§12.3 step 2)", () => {
	assertEquals(
		isExpired(validEnvelope({ expiresAt: new Date(Date.now() - 1).toISOString() })),
		true,
	);
});

Deno.test("isExpired: ちょうどnowと同じ時刻は期限切れ扱い（境界は安全側）", () => {
	const now = new Date();
	assertEquals(isExpired(validEnvelope({ expiresAt: now.toISOString() }), now), true);
});
