import type { CheckRunUpdate } from "@yoroi/github";
import type { ReasonGraphNode } from "@yoroi/policy";
import { renderReasonGraphMarkdown, STAGE_LABEL_JA, type SummaryState } from "./render.ts";

/**
 * design.md §14.1/§9.3's Check Run detail: `yoroi/gate` is the one required
 * check GitHub sees (§1.3 decision 1); this renders its body from the same
 * `SummaryState`/`ReasonGraphNode` the PR comment uses, so the two never
 * disagree.
 */
export function buildCheckRunOutput(
	state: SummaryState,
	reasonGraph: ReasonGraphNode,
): CheckRunUpdate {
	const completed = state.stage === "merged" || state.stage === "block";
	return {
		status: completed ? "completed" : "in_progress",
		conclusion: state.stage === "merged"
			? "success"
			: state.stage === "block"
			? "failure"
			: undefined,
		title: STAGE_LABEL_JA[state.stage],
		summary: state.reasonHeadline,
		text: renderReasonGraphMarkdown(reasonGraph),
	};
}
