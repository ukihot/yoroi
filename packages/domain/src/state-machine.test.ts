import { assertEquals } from '@std/assert';
import fc from 'fast-check';
import {
	ALLOWED_TRANSITIONS,
	type PrState,
	type PrStateRow,
	reduce,
	type StateEvent
} from './state-machine.ts';
import { actorStableId, operationId, sha, sha256Hex } from './ids.ts';

const ALL_STATES: PrState[] = [
	'DISCOVERED',
	'DRAFT',
	'REVIEWING',
	'APPROVAL_COVERED',
	'PRECHECKED',
	'QUEUED',
	'CANDIDATE_BUILDING',
	'GATE_PASSED',
	'MERGING',
	'MERGED',
	'OBSERVING',
	'SUPERSEDED',
	'PAUSED',
	'QUARANTINED',
	'REVERTING'
];
const prStateArb = fc.constantFrom(...ALL_STATES);

function rowWith(state: PrState, observedAt: Date): PrStateRow {
	return {
		state,
		stateVersion: 1,
		headSha: sha('a'.repeat(40)),
		candidateSha: null,
		lastObservedAt: observedAt
	};
}

function eventTo(toState: PrState, occurredAt: Date): StateEvent {
	return {
		operationId: operationId('01J000000000000000000000'),
		toState,
		actor: { kind: 'yoroi', stableId: actorStableId('yoroi') },
		reasonCode: 'test',
		observedHeadSha: sha('b'.repeat(40)),
		inputDigest: sha256Hex('0'.repeat(64)),
		occurredAt
	};
}

Deno.test('状態機械は許可された遷移のみ受理する (design.md §20.2)', () => {
	fc.assert(
		fc.property(prStateArb, prStateArb, (from, to) => {
			const allowed = ALLOWED_TRANSITIONS.get(from)!.has(to);
			const base = new Date('2026-01-01T00:00:00Z');
			const result = reduce(rowWith(from, base), eventTo(to, new Date(base.getTime() + 1000)));
			assertEquals(result.ok, allowed);
		})
	);
});

Deno.test('stateVersionは遷移が受理されるたびに単調増加する', () => {
	const base = new Date('2026-01-01T00:00:00Z');
	const row = rowWith('DISCOVERED', base);
	const result = reduce(row, eventTo('REVIEWING', new Date(base.getTime() + 1000)));
	assertEquals(result.ok, true);
	if (result.ok) assertEquals(result.value.stateVersion, row.stateVersion + 1);
});

Deno.test('occurredAtが現在のlastObservedAt以前のeventはSTALE_EVENTとして拒否される', () => {
	const base = new Date('2026-01-01T00:00:10Z');
	const row = rowWith('DISCOVERED', base);
	const staleEvent = eventTo('REVIEWING', new Date(base.getTime() - 5000));
	const result = reduce(row, staleEvent);
	assertEquals(result.ok, false);
	if (!result.ok) assertEquals(result.error.kind, 'STALE_EVENT');
});

Deno.test('終端状態（SUPERSEDED/REVERTING）からはどこへも遷移できない', () => {
	fc.assert(
		fc.property(prStateArb, (to) => {
			const base = new Date('2026-01-01T00:00:00Z');
			for (const terminal of ['SUPERSEDED', 'REVERTING'] as const) {
				const result = reduce(
					rowWith(terminal, base),
					eventTo(to, new Date(base.getTime() + 1000))
				);
				assertEquals(result.ok, false);
			}
		})
	);
});
