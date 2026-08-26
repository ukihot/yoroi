import { assertEquals, assertNotEquals } from "@std/assert";
import { compilePolicy } from "./compile.ts";
import type { PolicyDocument } from "./schema.ts";

function validDoc(overrides: Partial<PolicyDocument> = {}): PolicyDocument {
	return {
		version: "yoroi/v2",
		defaults: {
			gate_check: "yoroi/gate",
			queue: { mode: "serial", aging: "p50-based" },
			approval_continuity: {
				algorithm: "scope-change-v1",
				whitespace: "exact",
				context_proof: "deterministic-replay",
				high_risk_base_overlap: "reapprove",
				ambiguous: "invalidate-affected",
			},
			draft: { candidate: "disabled", checks: ["secret-scan"] },
			questionnaire: { mode: "triggered" },
			notifications: { mutable_summary: true, coalesce: "10m" },
		},
		scopes: [
			{
				id: "frontend",
				match: ["src/**"],
				require: { approvals: [{ role: "reviewer", count: 1 }] },
			},
		],
		break_glass: {
			approvals: 2,
			distinct_actors: true,
			max_ttl: "2h",
			require_ticket: true,
			require_post_review: true,
		},
		...overrides,
	};
}

Deno.test("compilePolicy: 正しいorg policyのみでcompileできる (repo/branch=null)", async () => {
	const result = await compilePolicy(validDoc(), null, null);
	assertEquals(result.ok, true);
	if (!result.ok) return;
	assertEquals(result.value.raw.scopes.length, 1);
	assertEquals(result.value.scopeIndex.size, 1);
	assertEquals(typeof result.value.digest, "string");
});

Deno.test("compilePolicy: digestは同じ入力に対して決定論的 (FR-011)", async () => {
	const doc = validDoc();
	const r1 = await compilePolicy(doc, null, null);
	const r2 = await compilePolicy(doc, null, null);
	if (!r1.ok || !r2.ok) throw new Error("expected ok");
	assertEquals(r1.value.digest, r2.value.digest);
});

Deno.test("compilePolicy: 内容が変わればdigestも変わる", async () => {
	const base = await compilePolicy(validDoc(), null, null);
	const changed = await compilePolicy(
		validDoc({
			scopes: [
				{
					id: "frontend",
					match: ["src/**"],
					require: { approvals: [{ role: "reviewer", count: 2 }] },
				},
			],
		}),
		null,
		null,
	);
	if (!base.ok || !changed.ok) throw new Error("expected ok");
	assertNotEquals(base.value.digest, changed.value.digest);
});

Deno.test("compilePolicy: digestはJSONキー順に依存しない（正規化される）", async () => {
	const a = await compilePolicy(validDoc(), null, null);
	// フィールドの列挙順を変えても、構造上は同一の文書
	const reordered: PolicyDocument = JSON.parse(JSON.stringify(validDoc()));
	const b = await compilePolicy(reordered, null, null);
	if (!a.ok || !b.ok) throw new Error("expected ok");
	assertEquals(a.value.digest, b.value.digest);
});

Deno.test("compilePolicy: repoレベルのoverrideはexplicitにorgをkey単位で置き換える (P-08: 暗黙のlast-match禁止)", async () => {
	const org = validDoc();
	// TypeScriptのPartial<PolicyDocument>はトップレベルのみshallowだが、
	// mergeExplicitは実行時にnestしたobjectも再帰的にkey単位でmergeする
	// (design.md §9.2 mergeWithExplicitOverride)。
	const repoOverride = {
		defaults: { queue: { mode: "observe" } },
	} as unknown as Partial<PolicyDocument>;

	const result = await compilePolicy(org, repoOverride, null);
	assertEquals(result.ok, true);
	if (!result.ok) return;
	assertEquals(result.value.raw.defaults.queue.mode, "observe");
	// overrideで触れていないfieldはorgの値を維持する
	assertEquals(result.value.raw.defaults.queue.aging, "p50-based");
	assertEquals(result.value.raw.defaults.gate_check, "yoroi/gate");
});

Deno.test("compilePolicy: repoのscopes配列指定はorgのscopesを丸ごと置き換える（要素単位merge禁止）", async () => {
	const org = validDoc();
	const repoOverride = {
		scopes: [
			{
				id: "payments",
				match: ["payments/**"],
				require: { approvals: [{ role: "reviewer", count: 1 }] },
			},
		],
	} as unknown as Partial<PolicyDocument>;

	const result = await compilePolicy(org, repoOverride, null);
	assertEquals(result.ok, true);
	if (!result.ok) return;
	assertEquals(result.value.raw.scopes.length, 1);
	assertEquals(result.value.raw.scopes[0]?.id, "payments");
});

Deno.test("compilePolicy: 不正な文書はSCHEMA_INVALIDで安全側errorになる (FR-012)", async () => {
	const invalid = { ...validDoc(), version: "not-a-real-version" } as unknown as PolicyDocument;
	const result = await compilePolicy(invalid, null, null);
	assertEquals(result.ok, false);
	if (result.ok) return;
	assertEquals(result.error.kind, "SCHEMA_INVALID");
});

Deno.test("compilePolicy: 空の必須check集合はEMPTY_REQUIRED_CHECK_SETで安全側errorになる (FR-012)", async () => {
	const doc = validDoc({
		scopes: [
			{
				id: "frontend",
				match: ["src/**"],
				require: { approvals: [{ role: "reviewer", count: 1 }], checks: [] },
			},
		],
	});
	const result = await compilePolicy(doc, null, null);
	assertEquals(result.ok, false);
	if (result.ok) return;
	assertEquals(result.error.kind, "EMPTY_REQUIRED_CHECK_SET");
});
