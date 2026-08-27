import type { ActorStableId, OperationId, Sha, Sha256Hex } from './ids.ts';
import { err, ok, type Result } from './result.ts';

/** design.md §5.1, verbatim. */
export type PrState =
	| 'DISCOVERED'
	| 'DRAFT'
	| 'REVIEWING'
	| 'APPROVAL_COVERED'
	| 'PRECHECKED'
	| 'QUEUED'
	| 'CANDIDATE_BUILDING'
	| 'GATE_PASSED'
	| 'MERGING'
	| 'MERGED'
	| 'OBSERVING'
	| 'SUPERSEDED'
	| 'PAUSED'
	| 'QUARANTINED'
	| 'REVERTING';

export const ALLOWED_TRANSITIONS: ReadonlyMap<PrState, ReadonlySet<PrState>> = new Map([
	['DISCOVERED', new Set<PrState>(['DRAFT', 'REVIEWING'])],
	['DRAFT', new Set<PrState>(['REVIEWING'])],
	['REVIEWING', new Set<PrState>(['APPROVAL_COVERED', 'SUPERSEDED'])],
	// 承認失効（FR-025）でREVIEWINGへ後退できる
	['APPROVAL_COVERED', new Set<PrState>(['PRECHECKED', 'REVIEWING'])],
	['PRECHECKED', new Set<PrState>(['QUEUED', 'REVIEWING'])],
	['QUEUED', new Set<PrState>(['CANDIDATE_BUILDING', 'PAUSED', 'REVIEWING'])],
	['CANDIDATE_BUILDING', new Set<PrState>(['GATE_PASSED', 'QUARANTINED', 'QUEUED'])],
	// GATE_PASSEDは期限付き（8.4）。base/head/policy更新やtree closeで候補側へ戻す
	['GATE_PASSED', new Set<PrState>(['MERGING', 'CANDIDATE_BUILDING'])],
	// merge直前再検証（8.4 "MERGING直前"）が失敗した場合は候補作り直し
	['MERGING', new Set<PrState>(['MERGED', 'CANDIDATE_BUILDING'])],
	['MERGED', new Set<PrState>(['OBSERVING'])],
	['OBSERVING', new Set<PrState>(['REVERTING'])],
	['PAUSED', new Set<PrState>(['QUEUED'])],
	['QUARANTINED', new Set<PrState>(['CANDIDATE_BUILDING', 'REVIEWING'])],
	['SUPERSEDED', new Set<PrState>([])],
	['REVERTING', new Set<PrState>([])]
]);

/**
 * design.md §5.2's `PrStateRow` + one addition: `lastObservedAt`. design.md
 * shows `isOlderOrEqualStaleSha(event.observedHeadSha, current)` used inside
 * `reduce()` but never defines it, and git SHAs have no total order to
 * compare by value — a rebase can produce a "smaller" hash for a strictly
 * newer commit. What GitHub's webhook delivery order (also not guaranteed,
 * FR-005) *does* give us reliably is each event's own timestamp, so
 * staleness here is judged by `occurredAt` against the last event we
 * actually applied, not by comparing SHA bytes. This is a deliberate
 * interpretation of an underspecified helper, not a verbatim port — see the
 * plan notes. It's one layer of several: `state_version`-based optimistic
 * concurrency at the DB write (packages/postgres) and the Merger's
 * re-fetch-before-merge (§12.3) are the actual safety net for merge
 * decisions; this only keeps the *displayed* state from flapping backward.
 */
export interface PrStateRow {
	readonly state: PrState;
	readonly stateVersion: number; // 楽観的並行制御（6章）
	readonly headSha: Sha;
	readonly candidateSha: Sha | null;
	readonly lastObservedAt: Date;
}

export interface StateEvent {
	readonly operationId: OperationId;
	readonly toState: PrState;
	readonly actor: { readonly kind: 'user' | 'yoroi'; readonly stableId: ActorStableId | null };
	readonly reasonCode: string;
	readonly observedHeadSha: Sha;
	readonly inputDigest: Sha256Hex; // 何を根拠に遷移したか（監査・reason graph用）
	readonly occurredAt: Date;
}

export type TransitionRejected =
	| { readonly kind: 'STALE_EVENT'; readonly eventOccurredAt: Date; readonly lastObservedAt: Date }
	| { readonly kind: 'ILLEGAL_TRANSITION'; readonly from: PrState; readonly to: PrState };

/** design.md §5.2. Pure function: DB update happens at the call site via
 * `UPDATE ... WHERE state_version = $expected` (packages/postgres). */
export function reduce(
	current: PrStateRow,
	event: StateEvent
): Result<PrStateRow, TransitionRejected> {
	// P-05, 8.4: 古いeventで新しい観測状態を後退させない
	if (event.occurredAt.getTime() <= current.lastObservedAt.getTime()) {
		return err({
			kind: 'STALE_EVENT',
			eventOccurredAt: event.occurredAt,
			lastObservedAt: current.lastObservedAt
		});
	}
	const allowed = ALLOWED_TRANSITIONS.get(current.state) ?? new Set<PrState>();
	if (!allowed.has(event.toState)) {
		return err({ kind: 'ILLEGAL_TRANSITION', from: current.state, to: event.toState });
	}
	return ok({
		state: event.toState,
		stateVersion: current.stateVersion + 1,
		headSha: event.observedHeadSha,
		candidateSha: current.candidateSha,
		lastObservedAt: event.occurredAt
	});
}
