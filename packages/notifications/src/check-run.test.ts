import { assertEquals } from "@std/assert";
import { buildCheckRunOutput } from "./check-run.ts";
import type { SummaryState } from "./render.ts";
import type { ReasonGraphNode } from "@yoroi/policy";

const graph: ReasonGraphNode = { label: "Merge可能", children: [] };

function state(overrides: Partial<SummaryState> = {}): SummaryState {
	return {
		stage: "review",
		reasonHeadline: "レビュー待ち",
		nextActor: "reviewer",
		etaRange: null,
		confidence: null,
		...overrides,
	};
}

Deno.test("buildCheckRunOutput: mergedはcompleted/successになる", () => {
	const output = buildCheckRunOutput(state({ stage: "merged" }), graph);
	assertEquals(output.status, "completed");
	assertEquals(output.conclusion, "success");
});

Deno.test("buildCheckRunOutput: blockはcompleted/failureになる", () => {
	const output = buildCheckRunOutput(state({ stage: "block" }), graph);
	assertEquals(output.status, "completed");
	assertEquals(output.conclusion, "failure");
});

Deno.test("buildCheckRunOutput: review/queue/ciはin_progressでconclusionを持たない", () => {
	for (const stage of ["review", "queue", "ci"] as const) {
		const output = buildCheckRunOutput(state({ stage }), graph);
		assertEquals(output.status, "in_progress");
		assertEquals(output.conclusion, undefined);
	}
});

Deno.test("buildCheckRunOutput: summaryはreasonHeadline、textはreason graphの描画", () => {
	const output = buildCheckRunOutput(state({ reasonHeadline: "テスト実行中" }), graph);
	assertEquals(output.summary, "テスト実行中");
	assertEquals(output.text, "- Merge可能");
});
