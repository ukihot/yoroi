import { assertEquals } from "@std/assert";
import { type PolicyDocument, PolicySchema } from "./schema.ts";

function validDoc(): PolicyDocument {
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
	};
}

Deno.test("PolicySchema: design.md §9.1準拠の正しい文書はparseできる", () => {
	const result = PolicySchema.safeParse(validDoc());
	assertEquals(result.success, true);
});

Deno.test("PolicySchema: トップレベルの未知フィールドは拒否される (FR-012)", () => {
	const doc = { ...validDoc(), unknown_field: "x" };
	const result = PolicySchema.safeParse(doc);
	assertEquals(result.success, false);
});

Deno.test("PolicySchema: ネストしたscope内の未知フィールドも拒否される (.strict()の伝播)", () => {
	const doc = validDoc();
	const withUnknown = {
		...doc,
		scopes: [{ ...doc.scopes[0], unexpected: true }],
	};
	const result = PolicySchema.safeParse(withUnknown);
	assertEquals(result.success, false);
});

Deno.test("PolicySchema: versionが違うリテラルなら拒否される", () => {
	const doc = { ...validDoc(), version: "yoroi/v1" };
	const result = PolicySchema.safeParse(doc);
	assertEquals(result.success, false);
});

Deno.test("PolicySchema: break_glassは必須（省略すると拒否される）", () => {
	const doc = validDoc() as Partial<PolicyDocument>;
	delete doc.break_glass;
	const result = PolicySchema.safeParse(doc);
	assertEquals(result.success, false);
});

Deno.test("PolicySchema: risk / self_serviceは省略可能", () => {
	const result = PolicySchema.safeParse(validDoc());
	assertEquals(result.success, true);
});

Deno.test("PolicySchema: approval roleが未知のenum値なら拒否される", () => {
	const doc = validDoc();
	const withBadRole = {
		...doc,
		scopes: [
			{ ...doc.scopes[0], require: { approvals: [{ role: "ceo", count: 1 }] } },
		],
	};
	const result = PolicySchema.safeParse(withBadRole);
	assertEquals(result.success, false);
});
