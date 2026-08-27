import type { ApprovalCarryForward } from '@yoroi/domain';

/**
 * design.md §23.4's My Work screen usage: renders the human-legible text
 * that shows a reviewer/author *why* an approval survived a rebase/
 * force-push — the original review, the old/new SHAs, which scopes were
 * judged unchanged, and the proof algorithm that judged it (design.md
 * §7.2's carry-forward display requirement, AT-04A/04F).
 */
export function explainCarryForward(carryForward: ApprovalCarryForward): string {
	const shortOld = carryForward.oldHeadSha.slice(0, 7);
	const shortNew = carryForward.newHeadSha.slice(0, 7);
	const scopes =
		carryForward.unchangedScopeIds.length > 0
			? carryForward.unchangedScopeIds.join(', ')
			: '(なし)';
	return (
		`review ${carryForward.originalReviewId} での承認を維持しました（${shortOld} → ${shortNew}）。` +
		`scope [${scopes}] の変更内容は新base上でも同一と判定されました` +
		`（proof: ${carryForward.proofAlgorithm}, digest: ${carryForward.contextProofDigest.slice(
			0,
			12
		)}…）。`
	);
}
