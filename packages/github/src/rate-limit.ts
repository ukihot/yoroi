import type { RateLimitStatus } from './adapter.ts';

/** design.md §13.4: below 20% remaining, low-priority (dashboard-facing)
 * reads back off; this is a pure decision function of the observed status
 * so it's testable without a live rate-limit header. */
export interface RateLimitDecision {
	readonly shouldBackoffLowPriority: boolean;
	readonly critical: boolean; // §24.7's "red" threshold (5%)
}

export function decideRateLimitBackoff(
	status: Pick<RateLimitStatus, 'remainingPct'>
): RateLimitDecision {
	return {
		shouldBackoffLowPriority: status.remainingPct < 20,
		critical: status.remainingPct < 5
	};
}
