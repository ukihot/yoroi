import type { ReasonGraphNode } from "@yoroi/policy";

/** design.md §8.1/§14.2's four-question translation. */
export type SummaryStage = "review" | "queue" | "ci" | "block" | "merged";
export type NextActor = "author" | "reviewer" | "yoroi" | "operator";
export type EtaConfidence = "low" | "medium" | "high";

export interface SummaryState {
	readonly stage: SummaryStage;
	readonly reasonHeadline: string;
	readonly nextActor: NextActor;
	readonly etaRange: readonly [Date, Date] | null;
	readonly confidence: EtaConfidence | null;
}

export const STAGE_LABEL_JA: Readonly<Record<SummaryStage, string>> = {
	review: "レビュー中",
	queue: "キュー待ち",
	ci: "CI実行中",
	block: "ブロック中",
	merged: "マージ済み",
};

export const ACTOR_LABEL_JA: Readonly<Record<NextActor, string>> = {
	author: "Author",
	reviewer: "Reviewer",
	yoroi: "Yoroi",
	operator: "Operator",
};

const CONFIDENCE_LABEL_JA: Readonly<Record<EtaConfidence, string>> = {
	low: "低",
	medium: "中",
	high: "高",
};

function formatDateJa(date: Date): string {
	const mm = date.getMonth() + 1;
	const dd = date.getDate();
	const hh = String(date.getHours()).padStart(2, "0");
	const min = String(date.getMinutes()).padStart(2, "0");
	return `${mm}/${dd} ${hh}:${min}`;
}

/** design.md §8.1/§14.5/AT-33: never fabricate false precision — when there's
 * no range, say why it's unavailable rather than showing a blank or a lie. */
export function formatEtaRangeJa(
	etaRange: readonly [Date, Date] | null,
	confidence: EtaConfidence | null,
): string {
	if (!etaRange) return "推定不能（データ不足のため）";
	const [from, to] = etaRange;
	const confidenceLabel = confidence ? CONFIDENCE_LABEL_JA[confidence] : "不明";
	return `${formatDateJa(from)} 〜 ${formatDateJa(to)}（信頼度: ${confidenceLabel}）`;
}

/** design.md §14/§23.4: reason graph rendered as a nested markdown list. */
export function renderReasonGraphMarkdown(node: ReasonGraphNode, depth = 0): string {
	const indent = "  ".repeat(depth);
	const line = `${indent}- ${node.label}`;
	if (node.children.length === 0) return line;
	const children = node.children.map((c) => renderReasonGraphMarkdown(c, depth + 1)).join("\n");
	return `${line}\n${children}`;
}

/** design.md §14.2: exactly the four questions from §8.1, followed by the
 * reason graph body. */
export function renderSummaryMarkdown(state: SummaryState, reasonGraph: ReasonGraphNode): string {
	return [
		`**今どこか**: ${STAGE_LABEL_JA[state.stage]}`,
		`**なぜか**: ${state.reasonHeadline}`,
		`**次に誰が何をするか**: ${ACTOR_LABEL_JA[state.nextActor]}`,
		`**いつ頃か**: ${formatEtaRangeJa(state.etaRange, state.confidence)}`,
		"",
		renderReasonGraphMarkdown(reasonGraph),
	].join("\n");
}
