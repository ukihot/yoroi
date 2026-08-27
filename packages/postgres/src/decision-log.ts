import { asc, desc, eq } from 'drizzle-orm';
import type { Db } from './client.ts';
import { decisionEvent } from './schema.ts';
import { computeRowHash, GENESIS_HASH } from '@yoroi/evidence';
import type { ChainedDecisionEventRow, DecisionEventHashInput } from '@yoroi/evidence';

export interface AppendDecisionEventInput {
	readonly operationId: string | null;
	readonly repoId: string;
	readonly prNumber: number | null;
	readonly actorStableId: string | null;
	readonly operation: string;
	readonly fromState: string | null;
	readonly toState: string | null;
	readonly reasonCode: string;
	readonly result: string;
	readonly evidence: unknown;
}

/**
 * design.md §6.7/AT-19: the only way to insert a `decision_event` row —
 * never `db.insert(decisionEvent)` directly — so `prev_hash`/`row_hash` form
 * an unbroken chain. Chained per `repoId` (the natural audit boundary
 * design.md's SEC-019 already keys every table by, and the unit every
 * apps/control audit query already scopes to).
 *
 * `occurredAt` is computed here in application code (not left to the
 * column's `defaultNow()`) so the exact same timestamp value that gets
 * stored is also the one hashed — letting Postgres fill it independently
 * would hash a different instant than what's persisted, breaking
 * `verifyChain` from the very first read.
 */
export function appendDecisionEvent(
	db: Db,
	input: AppendDecisionEventInput
): Promise<{ readonly seq: number; readonly rowHash: string }> {
	return db.transaction(async (tx) => {
		const [latest] = await tx
			.select({ rowHash: decisionEvent.rowHash })
			.from(decisionEvent)
			.where(eq(decisionEvent.repoId, input.repoId))
			.orderBy(desc(decisionEvent.seq))
			.limit(1);

		const prevHash = latest?.rowHash ?? GENESIS_HASH;
		const occurredAt = new Date();
		const hashInput: DecisionEventHashInput = {
			operationId: input.operationId,
			repoId: input.repoId,
			prNumber: input.prNumber,
			actorStableId: input.actorStableId,
			operation: input.operation,
			fromState: input.fromState,
			toState: input.toState,
			reasonCode: input.reasonCode,
			result: input.result,
			evidence: input.evidence,
			occurredAt: occurredAt.toISOString()
		};
		const rowHash = await computeRowHash(prevHash, hashInput);

		const [row] = await tx
			.insert(decisionEvent)
			.values({
				operationId: input.operationId,
				repoId: input.repoId,
				prNumber: input.prNumber,
				actorStableId: input.actorStableId,
				operation: input.operation,
				fromState: input.fromState,
				toState: input.toState,
				reasonCode: input.reasonCode,
				result: input.result,
				evidence: input.evidence,
				prevHash,
				rowHash,
				occurredAt
			})
			.returning({ seq: decisionEvent.seq });
		if (!row) throw new Error('appendDecisionEvent: insert returned no row');
		return { seq: row.seq, rowHash };
	});
}

/** Loads a repo's chain in `@yoroi/evidence`'s `verifyChain`-ready shape —
 * used by the `evidence-completeness` Cron job (design.md §17.2) and by
 * audit tooling to confirm no row has been tampered with (AT-19). Rows
 * written before the 0003 migration have `null` prev/row hash; those are
 * surfaced as-is (not backfilled with `GENESIS_HASH`) so `verifyChain`
 * correctly reports them as unchainable rather than silently treating them
 * as a fresh chain start. */
export async function loadDecisionEventChain(
	db: Db,
	repoId: string,
	limit = 1000
): Promise<ChainedDecisionEventRow[]> {
	const rows = await db
		.select()
		.from(decisionEvent)
		.where(eq(decisionEvent.repoId, repoId))
		.orderBy(asc(decisionEvent.seq))
		.limit(limit);

	return rows.map((r) => ({
		operationId: r.operationId,
		repoId: r.repoId,
		prNumber: r.prNumber,
		actorStableId: r.actorStableId,
		operation: r.operation,
		fromState: r.fromState,
		toState: r.toState,
		reasonCode: r.reasonCode,
		result: r.result,
		evidence: r.evidence,
		occurredAt: r.occurredAt.toISOString(),
		prevHash: r.prevHash ?? '',
		rowHash: r.rowHash ?? ''
	}));
}
