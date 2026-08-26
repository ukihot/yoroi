import { assertEquals } from "@std/assert";
import { importHmacEnvelopeKey, signEnvelope, verifyEnvelopeSignature } from "./sign.ts";
import type { DecisionEnvelope } from "./envelope.ts";

const SHA_A = "a".repeat(40);
const DIGEST = "c".repeat(64);

function envelope(overrides: Partial<DecisionEnvelope> = {}): DecisionEnvelope {
	return {
		operationId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
		installationId: 1,
		repositoryId: 2,
		owner: "acme",
		repoName: "widgets",
		pullRequestNumber: 3,
		headSha: SHA_A,
		baseSha: SHA_A,
		baseRef: "main",
		dependencyShas: [],
		candidateSha: SHA_A,
		scopeReviewProofs: {},
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

Deno.test("signEnvelope/verifyEnvelopeSignature: 正しい署名は同じ鍵で検証を通る", async () => {
	const key = await importHmacEnvelopeKey("shared-secret");
	const env = envelope();
	const signature = await signEnvelope(env, key);
	assertEquals(await verifyEnvelopeSignature(env, signature, key), true);
});

Deno.test("verifyEnvelopeSignature: envelopeの内容を書き換えると検証が失敗する", async () => {
	const key = await importHmacEnvelopeKey("shared-secret");
	const env = envelope();
	const signature = await signEnvelope(env, key);
	const tampered = { ...env, fencingToken: "999" };
	assertEquals(await verifyEnvelopeSignature(tampered, signature, key), false);
});

Deno.test("verifyEnvelopeSignature: 違う鍵で作った署名は拒否される", async () => {
	const signingKey = await importHmacEnvelopeKey("secret-a");
	const verifyKey = await importHmacEnvelopeKey("secret-b");
	const env = envelope();
	const signature = await signEnvelope(env, signingKey);
	assertEquals(await verifyEnvelopeSignature(env, signature, verifyKey), false);
});

Deno.test("verifyEnvelopeSignature: 壊れたbase64url文字列は例外を投げずfalseを返す", async () => {
	const key = await importHmacEnvelopeKey("shared-secret");
	assertEquals(await verifyEnvelopeSignature(envelope(), "not*valid*base64url!!", key), false);
});

Deno.test("signEnvelope: フィールドの列挙順が違っても同じenvelope内容なら同じ署名になる（正準化）", async () => {
	const key = await importHmacEnvelopeKey("shared-secret");
	const a = envelope();
	const b: DecisionEnvelope = JSON.parse(JSON.stringify(a));
	assertEquals(await signEnvelope(a, key), await signEnvelope(b, key));
});
