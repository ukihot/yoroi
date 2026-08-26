import { assertStringIncludes } from "@std/assert";
import { explainCarryForward } from "./carry-forward-explanation.ts";
import type { ApprovalCarryForward } from "@yoroi/domain";
import { scopeId, sha, sha256Hex } from "@yoroi/domain";

function carryForward(overrides: Partial<ApprovalCarryForward> = {}): ApprovalCarryForward {
	return {
		originalReviewId: "review-123",
		oldBaseSha: sha("b".repeat(40)),
		oldHeadSha: sha("c".repeat(40)),
		newBaseSha: sha("d".repeat(40)),
		newHeadSha: sha("e".repeat(40)),
		unchangedScopeIds: [scopeId("frontend")],
		contextProofDigest: sha256Hex("f".repeat(64)),
		proofAlgorithm: "deterministic-replay-v1",
		...overrides,
	};
}

Deno.test("explainCarryForward: 元review IDを含む", () => {
	assertStringIncludes(explainCarryForward(carryForward()), "review-123");
});

Deno.test("explainCarryForward: 旧/新headの短縮SHAを含む", () => {
	const text = explainCarryForward(carryForward());
	assertStringIncludes(text, "ccccccc");
	assertStringIncludes(text, "eeeeeee");
});

Deno.test("explainCarryForward: 維持されたscope一覧を含む", () => {
	assertStringIncludes(explainCarryForward(carryForward()), "frontend");
});

Deno.test("explainCarryForward: proof algorithmを含む", () => {
	assertStringIncludes(explainCarryForward(carryForward()), "deterministic-replay-v1");
});

Deno.test("explainCarryForward: scopeが空でもクラッシュしない", () => {
	assertStringIncludes(explainCarryForward(carryForward({ unchangedScopeIds: [] })), "(なし)");
});
