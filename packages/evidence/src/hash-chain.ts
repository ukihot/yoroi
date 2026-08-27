/**
 * design.md §6.7's `decision_event` hash chain (`prev_hash`/`row_hash`) —
 * AT-19's tamper-detection mechanism: mutating any historical row changes
 * that row's own hash, which no longer matches what the *next* row recorded
 * as its `prev_hash`, so the break is detectable by re-walking the chain.
 *
 * This package owns the hashing function only. Application-level append-only
 * enforcement (never UPDATE/DELETE a `decision_event` row) is a DB-role grant
 * (SEC-037/§6.7) applied at the database layer, not something this pure
 * function can itself guarantee.
 */

export const GENESIS_HASH = '0'.repeat(64);

/** The fields that go into a row's hash — everything meaningful about the
 * event except `seq` (an auto-increment surrogate key, not evidence) and the
 * hash-chain columns themselves. */
export interface DecisionEventHashInput {
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
	readonly occurredAt: string; // ISO 8601 — a string so hashing doesn't depend on Date formatting
}

function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeysDeep);
	if (value !== null && typeof value === 'object') {
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
		}
		return sorted;
	}
	return value;
}

function toDigestInput(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		toDigestInput(new TextEncoder().encode(text))
	);
	return bytesToHex(new Uint8Array(digest));
}

/** `row_hash = SHA-256(prev_hash || canonical_json(fields))`. The genesis row
 * of a chain (first `decision_event` for a given installation/repository)
 * uses `GENESIS_HASH` as its `prevHash`. */
export function computeRowHash(prevHash: string, fields: DecisionEventHashInput): Promise<string> {
	return sha256Hex(prevHash + JSON.stringify(sortKeysDeep(fields)));
}

export interface ChainedDecisionEventRow extends DecisionEventHashInput {
	readonly prevHash: string;
	readonly rowHash: string;
}

export type ChainVerificationResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly brokenAtIndex: number; readonly reason: string };

/** Re-walks a sequence of rows (ordered by `seq` ascending) and confirms each
 * row's `prevHash` matches the previous row's `rowHash`, and each row's
 * `rowHash` matches what recomputing it from its own fields produces. Any
 * mismatch — a mutated field, a deleted/reordered row, an inserted row not
 * chained from its predecessor — is caught here (AT-19). */
export async function verifyChain(
	rows: readonly ChainedDecisionEventRow[],
	genesisPrevHash: string = GENESIS_HASH
): Promise<ChainVerificationResult> {
	let expectedPrevHash = genesisPrevHash;
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!;
		if (row.prevHash !== expectedPrevHash) {
			return {
				ok: false,
				brokenAtIndex: i,
				reason: "prev_hash does not match preceding row's row_hash"
			};
		}
		// Only the DecisionEventHashInput fields feed the hash — `row` also
		// carries `prevHash`/`rowHash` themselves, which must never be part of
		// their own hash's input material, so they're stripped explicitly
		// rather than trusting the (structurally wider) object shape.
		const { prevHash: _prevHash, rowHash: _rowHash, ...fields } = row;
		const recomputed = await computeRowHash(row.prevHash, fields);
		if (recomputed !== row.rowHash) {
			return {
				ok: false,
				brokenAtIndex: i,
				reason: 'row_hash does not match recomputed hash of row fields'
			};
		}
		expectedPrevHash = row.rowHash;
	}
	return { ok: true };
}
