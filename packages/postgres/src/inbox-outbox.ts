import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "./client.ts";
import { webhookInbox, workOutbox } from "./schema.ts";
import { encryptPayload } from "./encryption.ts";

export interface InsertInboxInput {
	readonly installationId: number;
	readonly repositoryId: number | null;
	readonly deliveryId: string;
	readonly eventType: string;
	readonly payloadDigest: string;
	readonly rawPayload: Uint8Array | null;
	readonly encryptionKey: string | null;
	readonly ttlHours: number | null;
}

export interface InsertOutboxInput {
	readonly operationId: string;
	readonly installationId: number;
	readonly repositoryId: number | null;
	readonly kind: string;
	readonly payload: unknown;
	readonly priority?: number;
}

/**
 * design.md §7.1: one transaction inserts inbox + (optionally) outbox.
 * `inserted: false` means this delivery_id was already processed (the
 * inbox's UNIQUE constraint caught it) — FR-004 dedup — and the caller must
 * not enqueue outbox work for it again.
 */
export function insertInboxAndOutbox(
	db: Db,
	inbox: InsertInboxInput,
	outbox: InsertOutboxInput | null,
): Promise<{ inserted: boolean }> {
	return db.transaction(async (tx) => {
		let payloadEncrypted: string | null = null;
		let expiresAt: Date | null = null;
		if (inbox.rawPayload && inbox.encryptionKey) {
			payloadEncrypted = await encryptPayload(inbox.rawPayload, inbox.encryptionKey);
			expiresAt = inbox.ttlHours ? new Date(Date.now() + inbox.ttlHours * 3_600_000) : null;
		}

		const rows = await tx
			.insert(webhookInbox)
			.values({
				installationId: inbox.installationId,
				repositoryId: inbox.repositoryId,
				deliveryId: inbox.deliveryId,
				eventType: inbox.eventType,
				payloadDigest: inbox.payloadDigest,
				payloadEncrypted,
				expiresAt,
			})
			.onConflictDoNothing({ target: [webhookInbox.installationId, webhookInbox.deliveryId] })
			.returning({ id: webhookInbox.id });

		if (rows.length === 0) return { inserted: false };

		if (outbox) {
			await tx.insert(workOutbox).values({
				operationId: outbox.operationId,
				installationId: outbox.installationId,
				repositoryId: outbox.repositoryId,
				kind: outbox.kind,
				payload: outbox.payload,
				priority: outbox.priority ?? 0,
			});
		}
		return { inserted: true };
	});
}

export interface OutboxWork {
	readonly id: number;
	readonly operationId: string;
	readonly installationId: number;
	readonly repositoryId: number | null;
	readonly kind: string;
	readonly payload: unknown;
	readonly attempt: number;
	readonly maxAttempt: number;
}

/** design.md §7.3, expressed via drizzle's query builder (`.for('update', {
 * skipLocked: true })`) rather than a raw SQL string, for typed results —
 * same locking semantics as the doc's literal `FOR UPDATE SKIP LOCKED`. */
export function claimOutboxBatch(db: Db, instanceId: string, limit = 20): Promise<OutboxWork[]> {
	return db.transaction(async (tx) => {
		const claimed = await tx
			.select({
				id: workOutbox.id,
				operationId: workOutbox.operationId,
				installationId: workOutbox.installationId,
				repositoryId: workOutbox.repositoryId,
				kind: workOutbox.kind,
				payload: workOutbox.payload,
				attempt: workOutbox.attempt,
				maxAttempt: workOutbox.maxAttempt,
			})
			.from(workOutbox)
			.where(and(eq(workOutbox.state, "pending"), lte(workOutbox.availableAt, new Date())))
			.orderBy(desc(workOutbox.priority), workOutbox.createdAt)
			.limit(limit)
			.for("update", { skipLocked: true });

		if (claimed.length === 0) return [];

		const ids = claimed.map((r) => r.id);
		await tx
			.update(workOutbox)
			.set({
				state: "leased",
				leaseOwner: instanceId,
				leaseUntil: new Date(Date.now() + 30_000),
				attempt: sql`${workOutbox.attempt} + 1`,
			})
			.where(inArray(workOutbox.id, ids));

		return claimed.map((r) => ({ ...r, attempt: r.attempt + 1 }));
	});
}

export async function markOutboxDone(db: Db, id: number): Promise<void> {
	await db.update(workOutbox).set({ state: "done" }).where(eq(workOutbox.id, id));
}

/** §7.3: exponential backoff on failure, `dead` (dead-letter) once
 * `attempt >= max_attempt` (SEC-024). */
export async function markOutboxFailed(
	db: Db,
	work: OutboxWork,
	errorMessage: string,
): Promise<void> {
	if (work.attempt >= work.maxAttempt) {
		await db.update(workOutbox).set({ state: "dead", lastError: errorMessage }).where(
			eq(workOutbox.id, work.id),
		);
		return;
	}
	const backoffSeconds = Math.min(2 ** work.attempt, 300);
	await db
		.update(workOutbox)
		.set({
			state: "pending",
			lastError: errorMessage,
			availableAt: new Date(Date.now() + backoffSeconds * 1000),
		})
		.where(eq(workOutbox.id, work.id));
}
