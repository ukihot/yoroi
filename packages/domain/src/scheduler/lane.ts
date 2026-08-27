import type { Sha } from '../ids.ts';

/**
 * design.md §11.2 (Speculative mode) — Phase 4, "概要設計" (overview design)
 * per §21's own phase table, not detailed enough in the doc to fully specify
 * an adaptive window/train orchestration. This is the one piece §11.2 *does*
 * give a concrete signature for (cumulative-candidate rebuild after an
 * ejection); it's a pure, tested building block, but nothing in
 * `apps/control` calls it yet — Serial (§11.1) is the only mode wired into
 * the live scheduler for this MVP (design.md §1.2/§20.1).
 */

export interface Lane {
	readonly laneId: string;
	/** [A], [A,B], [A,B,C] — cumulative heads up to and including this lane's position. */
	readonly cumulativeHeads: readonly Sha[];
	readonly candidateSha: Sha | null;
	readonly status: 'pending' | 'running' | 'passed' | 'failed' | 'ejected' | 'invalidated';
}

/**
 * A lane at or before `ejectedIndex` (the position of the PR that failed and
 * was ejected from the train) is untouched — it was already resolved before
 * the failure. Every later lane has the ejected position removed from its
 * `cumulativeHeads`, and its own candidate/status reset since it must be
 * rebuilt without the ejected PR.
 */
export function rebuildAfterEjection(
	lanes: readonly Lane[],
	ejectedIndex: number
): readonly Lane[] {
	return lanes.map((lane, laneIndex) => {
		if (laneIndex <= ejectedIndex) return lane;
		return {
			...lane,
			cumulativeHeads: lane.cumulativeHeads.filter(
				(_head, headIndex) => headIndex !== ejectedIndex
			),
			candidateSha: null,
			status: 'pending'
		};
	});
}
