import { assertEquals, assertStringIncludes } from "@std/assert";
import {
	formatEtaRangeJa,
	renderReasonGraphMarkdown,
	renderSummaryMarkdown,
	type SummaryState,
} from "./render.ts";
import type { ReasonGraphNode } from "@yoroi/policy";

Deno.test("formatEtaRangeJa: 範囲がnullなら推定不能の理由を表示する (AT-33)", () => {
	assertEquals(formatEtaRangeJa(null, null), "推定不能（データ不足のため）");
});

Deno.test("formatEtaRangeJa: 範囲とconfidenceがあれば両方を含む文字列を返す", () => {
	const from = new Date(2026, 7, 26, 10, 0);
	const to = new Date(2026, 7, 26, 12, 0);
	const text = formatEtaRangeJa([from, to], "high");
	assertStringIncludes(text, "10:00");
	assertStringIncludes(text, "12:00");
	assertStringIncludes(text, "信頼度: 高");
});

Deno.test("renderReasonGraphMarkdown: 子がなければ1行のみ", () => {
	const node: ReasonGraphNode = { label: "Merge可能", children: [] };
	assertEquals(renderReasonGraphMarkdown(node), "- Merge可能");
});

Deno.test("renderReasonGraphMarkdown: 子はインデントされたネストになる", () => {
	const node: ReasonGraphNode = {
		label: "Merge不可",
		children: [
			{ label: "G1 Identity / Approval未成立", children: [{ label: "承認不足", children: [] }] },
		],
	};
	const rendered = renderReasonGraphMarkdown(node);
	assertEquals(
		rendered,
		"- Merge不可\n  - G1 Identity / Approval未成立\n    - 承認不足",
	);
});

Deno.test("renderSummaryMarkdown: 4つの問いを全て含む (design.md §8.1)", () => {
	const state: SummaryState = {
		stage: "block",
		reasonHeadline: "承認が不足しています",
		nextActor: "reviewer",
		etaRange: null,
		confidence: null,
	};
	const graph: ReasonGraphNode = { label: "Merge不可", children: [] };
	const markdown = renderSummaryMarkdown(state, graph);
	assertStringIncludes(markdown, "**今どこか**: ブロック中");
	assertStringIncludes(markdown, "**なぜか**: 承認が不足しています");
	assertStringIncludes(markdown, "**次に誰が何をするか**: Reviewer");
	assertStringIncludes(markdown, "**いつ頃か**: 推定不能");
	assertStringIncludes(markdown, "- Merge不可");
});
