import { sha, sha256Hex } from "./ids.ts";
import type { ScopeId, Sha, Sha256Hex } from "./ids.ts";

/** design.md §8.2, verbatim shape. */
export type ChangeKind = "add" | "delete" | "modify" | "rename" | "mode";

export interface CanonicalChangeRecord {
	readonly beforePath: string | null;
	readonly afterPath: string | null;
	readonly changeKind: ChangeKind;
	readonly objectType: "blob" | "tree" | "commit"; // commit = submodule gitlink
	readonly modeBefore: string | null; // 例 "100644"
	readonly modeAfter: string | null;
	/**
	 * design.md leaves this field's exact byte semantics unspecified beyond
	 * "whitespace保持、hunk位置のみ正規化" — that phrasing describes a unified
	 * diff hunk. This implementation instead stores the **full resulting
	 * content at afterPath** (not a diff/patch), because context-proof.ts's
	 * data-only apply engine needs to *replay* changes onto a different base
	 * without a general-purpose patch/merge algorithm (reimplementing `git
	 * apply` is its own large project, well beyond what this pass covers).
	 * "Same exact bytes, whitespace included" is preserved either way; only
	 * *how* the bytes are stored differs from the doc's illustrative comment.
	 * See context-proof.ts's top comment.
	 */
	readonly exactChangeBytes: Uint8Array;
	readonly binaryBeforeOid: Sha | null;
	readonly binaryAfterOid: Sha | null;
}

export interface ScopeChangeDigestInput {
	readonly digestAlgorithmVersion: "scope-change-v1";
	readonly scopeMappingVersion: string;
	readonly scopeId: ScopeId;
	readonly records: readonly CanonicalChangeRecord[];
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((sum, c) => sum + c.length, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}

function utf8(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

function lengthPrefixed(bytes: Uint8Array): Uint8Array {
	const prefix = new Uint8Array(4);
	new DataView(prefix.buffer).setUint32(0, bytes.length, false);
	return concatBytes(prefix, bytes);
}

/** null vs "" must never collide — a 1-byte presence flag disambiguates them. */
function encodeNullableString(value: string | null): Uint8Array {
	if (value === null) return new Uint8Array([0]);
	return concatBytes(new Uint8Array([1]), lengthPrefixed(utf8(value)));
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** `crypto.subtle.digest` wants a plain `ArrayBuffer`-backed view; a
 * `Uint8Array` built by `concatBytes`/`TextEncoder` can be typed against a
 * wider `ArrayBufferLike` under recent TS lib defs, so this narrows it. */
function toDigestInput(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function sha256HexOf(bytes: Uint8Array): Promise<Sha256Hex> {
	const digest = await crypto.subtle.digest("SHA-256", toDigestInput(bytes));
	return sha256Hex(bytesToHex(new Uint8Array(digest)));
}

/** git object id for a blob: sha1("blob " + len + "\0" + content) — matches
 * real GitHub-reported blob OIDs for classic (SHA-1) repositories, so
 * synthesized entries can be compared oid-for-oid against fetched ones.
 * SHA-256 git object format repos are not handled (noted as a known gap). */
export async function gitBlobOid(bytes: Uint8Array): Promise<Sha> {
	const header = utf8(`blob ${bytes.length}\0`);
	const digest = await crypto.subtle.digest("SHA-1", toDigestInput(concatBytes(header, bytes)));
	return sha(bytesToHex(new Uint8Array(digest)));
}

/**
 * Lexicographic comparison over the record's full length-prefixed encoding
 * (below) rather than a partial path + changeKind key -- two records that
 * share the same before/after path and changeKind but differ in
 * exactChangeBytes/objectType/mode/binary oid (e.g. both have
 * beforePath: null, afterPath: null -- an edge case the type system doesn't
 * forbid) would otherwise tie under a partial key, and since
 * Array.prototype.sort is a *stable* sort, a tie means the two inputs'
 * *original* relative order survives into the "sorted" output -- exactly the
 * non-determinism computeScopeChangeDigest exists to eliminate. Comparing
 * the full encoded bytes gives every distinct record a unique sort position
 * regardless of input order (caught by this file's own property test,
 * design.md §20.2).
 */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		const diff = a[i]! - b[i]!;
		if (diff !== 0) return diff;
	}
	return a.length - b.length;
}

function compareCanonicalChangeRecord(a: CanonicalChangeRecord, b: CanonicalChangeRecord): number {
	return compareBytes(
		encodeCanonicalRecordLengthPrefixed(a),
		encodeCanonicalRecordLengthPrefixed(b),
	);
}

function encodeCanonicalRecordLengthPrefixed(record: CanonicalChangeRecord): Uint8Array {
	return concatBytes(
		encodeNullableString(record.beforePath),
		encodeNullableString(record.afterPath),
		lengthPrefixed(utf8(record.changeKind)),
		lengthPrefixed(utf8(record.objectType)),
		encodeNullableString(record.modeBefore),
		encodeNullableString(record.modeAfter),
		lengthPrefixed(record.exactChangeBytes),
		encodeNullableString(record.binaryBeforeOid),
		encodeNullableString(record.binaryAfterOid),
	);
}

/** design.md §8.2. `[...records].sort(...)` internally: order-independent
 * (property-tested — shuffling the input never changes the digest). */
export function computeScopeChangeDigest(input: ScopeChangeDigestInput): Promise<Sha256Hex> {
	const sorted = [...input.records].sort(compareCanonicalChangeRecord);
	const material = concatBytes(
		lengthPrefixed(utf8(input.digestAlgorithmVersion)),
		lengthPrefixed(utf8(input.scopeMappingVersion)),
		lengthPrefixed(utf8(input.scopeId)),
		...sorted.map(encodeCanonicalRecordLengthPrefixed),
	);
	return sha256HexOf(material);
}

export interface ScopeResultEntry {
	readonly path: string;
	readonly objectType: string;
	readonly mode: string;
	readonly oid: Sha;
}

export function computeScopeResultDigest(entries: readonly ScopeResultEntry[]): Promise<Sha256Hex> {
	const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
	const material = concatBytes(
		...sorted.map((e) =>
			concatBytes(
				lengthPrefixed(utf8(e.path)),
				lengthPrefixed(utf8(e.objectType)),
				lengthPrefixed(utf8(e.mode)),
				lengthPrefixed(utf8(e.oid)),
			)
		),
	);
	return sha256HexOf(material);
}
