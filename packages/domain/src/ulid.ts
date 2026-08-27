import { decisionId, operationId } from './ids.ts';
import type { DecisionId, OperationId } from './ids.ts';

/**
 * `OperationId`/`DecisionId` are ULIDs per this package's own ids.ts comment.
 * Crockford base32 (no I/L/O/U — matches packages/evidence's
 * `DecisionEnvelopeSchema` ULID_PATTERN exactly): 10 chars of 48-bit
 * millisecond timestamp + 16 chars of randomness, 26 total. No external
 * dependency, same "small, hand-written, no npm dep" choice this package
 * already made for `matchesGlob`. Not strictly monotonic within the same
 * millisecond (randomness isn't seeded incrementally) — this codebase only
 * needs ULIDs as unique idempotency keys, never as a sort order.
 */
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(time: number, len: number): string {
	let str = '';
	let t = time;
	for (let i = len - 1; i >= 0; i--) {
		const mod = t % 32;
		str = CROCKFORD_ALPHABET[mod] + str;
		t = (t - mod) / 32;
	}
	return str;
}

function encodeRandom(len: number): string {
	let str = '';
	const bytes = new Uint8Array(len);
	crypto.getRandomValues(bytes);
	for (let i = 0; i < len; i++) {
		str += CROCKFORD_ALPHABET[bytes[i]! % 32];
	}
	return str;
}

export function generateUlid(now: number = Date.now()): string {
	return encodeTime(now, 10) + encodeRandom(16);
}

export function generateOperationId(): OperationId {
	return operationId(generateUlid());
}

export function generateDecisionId(): DecisionId {
	return decisionId(generateUlid());
}
