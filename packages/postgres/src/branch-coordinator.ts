import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from './client.ts';
import { branchCoordinator } from './schema.ts';

export interface BranchCoordinatorKey {
	readonly installationId: number;
	readonly repositoryId: number;
	readonly targetBranch: string;
}

/** Seeds the row a repo/branch needs before `acquireLease` can update it —
 * design.md §10.1's UPDATE assumes the row already exists; call this once
 * when a repo starts being managed (idempotent). */
export async function ensureBranchCoordinatorRow(db: Db, key: BranchCoordinatorKey): Promise<void> {
	await db
		.insert(branchCoordinator)
		.values({
			installationId: key.installationId,
			repositoryId: key.repositoryId,
			targetBranch: key.targetBranch
		})
		.onConflictDoNothing({
			target: [
				branchCoordinator.installationId,
				branchCoordinator.repositoryId,
				branchCoordinator.targetBranch
			]
		});
}

/**
 * design.md §10.1, expressed via drizzle's update builder — same atomic
 * "claim only if free or already ours" condition and monotonic
 * `fencing_token` increment as the doc's raw SQL. Returns `null` if another
 * operation currently holds the lease (§10.2 AT-34: the losing side gets no
 * token, so it can never build a valid Decision Envelope).
 */
export async function acquireLease(
	db: Db,
	key: BranchCoordinatorKey,
	operationId: string,
	expectedBaseSha: string
): Promise<{ fencingToken: bigint } | null> {
	const rows = await db
		.update(branchCoordinator)
		.set({
			holderOperationId: operationId,
			leaseUntil: sql`now() + interval '30 seconds'`,
			fencingToken: sql`${branchCoordinator.fencingToken} + 1`,
			expectedBaseSha,
			stateVersion: sql`${branchCoordinator.stateVersion} + 1`,
			updatedAt: sql`now()`
		})
		.where(
			and(
				eq(branchCoordinator.installationId, key.installationId),
				eq(branchCoordinator.repositoryId, key.repositoryId),
				eq(branchCoordinator.targetBranch, key.targetBranch),
				or(
					isNull(branchCoordinator.leaseUntil),
					lt(branchCoordinator.leaseUntil, sql`now()`),
					eq(branchCoordinator.holderOperationId, operationId)
				)
			)
		)
		.returning({ fencingToken: branchCoordinator.fencingToken });

	return rows[0] ?? null;
}

/**
 * design.md §12.3 step 3 / §10.2: yoroi-merger re-reads the current token
 * immediately before merging and rejects unless it exactly matches the
 * envelope's — this read, not lease expiry, is the actual safety net.
 */
export async function getCurrentFencingToken(
	db: Db,
	key: BranchCoordinatorKey
): Promise<bigint | null> {
	const [row] = await db
		.select({ fencingToken: branchCoordinator.fencingToken })
		.from(branchCoordinator)
		.where(
			and(
				eq(branchCoordinator.installationId, key.installationId),
				eq(branchCoordinator.repositoryId, key.repositoryId),
				eq(branchCoordinator.targetBranch, key.targetBranch)
			)
		)
		.limit(1);
	return row?.fencingToken ?? null;
}

/** design.md §10.3's `ttl-expiry` Cron: diagnostic/display cleanup only —
 * clearing a stale holder here does not itself make a lease safe to reuse;
 * `acquireLease`'s own `lease_until < now()` check already handles that
 * atomically. This just keeps `branch_coordinator` tidy for the dashboard. */
export async function clearExpiredLeaseHolders(db: Db): Promise<number> {
	const rows = await db
		.update(branchCoordinator)
		.set({ holderOperationId: null, leaseUntil: null })
		.where(and(lt(branchCoordinator.leaseUntil, sql`now()`)))
		.returning({ installationId: branchCoordinator.installationId });
	return rows.length;
}
