/**
 * design.md §11.3 (Batch mode / delta debugging) — Phase 4 overview design,
 * same dormant-building-block status as ./lane.ts (see its top comment).
 * `PrId` is a plain string here rather than a branded composite id: real
 * callers (once this is wired) would pass a `${repositoryId}:${pullRequestNumber}`
 * style key, but the algorithm itself is id-shape-agnostic.
 */

export type PrId = string;
export type CandidateResult = "pass" | "fail";
export type RunCandidate = (subset: readonly PrId[]) => Promise<CandidateResult>;

/**
 * Simplified `ddmin`: split the batch in half, run both halves concurrently.
 *  - fail / pass → recurse into the failing half only.
 *  - fail / fail → recurse into both halves, concatenate.
 *  - pass / pass → neither half alone reproduces the failure, so it's an
 *    interaction between the halves — resolved via `findInteractionPair`.
 */
export async function isolateFailureSet(
	batch: readonly PrId[],
	runCandidate: RunCandidate,
): Promise<readonly PrId[]> {
	if (batch.length <= 1) return batch;

	const mid = Math.floor(batch.length / 2);
	const left = batch.slice(0, mid);
	const right = batch.slice(mid);
	const [leftResult, rightResult] = await Promise.all([runCandidate(left), runCandidate(right)]);

	if (leftResult === "fail" && rightResult === "pass") return isolateFailureSet(left, runCandidate);
	if (leftResult === "pass" && rightResult === "fail") {
		return isolateFailureSet(right, runCandidate);
	}
	if (leftResult === "fail" && rightResult === "fail") {
		const [leftIsolated, rightIsolated] = await Promise.all([
			isolateFailureSet(left, runCandidate),
			isolateFailureSet(right, runCandidate),
		]);
		return [...leftIsolated, ...rightIsolated];
	}
	return findInteractionPair(left, right, runCandidate);
}

/** Pairwise search across the two halves for the smallest cross-half
 * interaction that reproduces the failure. If none is found (shouldn't
 * happen if the caller only invokes this on a batch confirmed to fail as a
 * whole, but defensively), the full two halves are returned rather than
 * claiming a false negative. */
export async function findInteractionPair(
	left: readonly PrId[],
	right: readonly PrId[],
	runCandidate: RunCandidate,
): Promise<readonly PrId[]> {
	for (const l of left) {
		for (const r of right) {
			const result = await runCandidate([l, r]);
			if (result === "fail") return [l, r];
		}
	}
	return [...left, ...right];
}

/** design.md §11.3/FR-059: circuit breaker key so the same
 * (batch, failure) pair doesn't retry indefinitely (P-02). */
export function circuitBreakerKey(batchFingerprint: string, failureFingerprint: string): string {
	return `${batchFingerprint}:${failureFingerprint}`;
}
