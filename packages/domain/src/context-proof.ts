import type { ScopeId, Sha, Sha256Hex } from './ids.ts';
import { err, ok, type Result } from './result.ts';
import {
	type CanonicalChangeRecord,
	computeScopeChangeDigest,
	computeScopeResultDigest,
	gitBlobOid,
	type ScopeResultEntry
} from './scope-digest.ts';

/**
 * design.md §8.3's `evaluateContextSafety` signature takes a `GitHubAdapter`
 * and fetches trees itself — but `GitHubAdapter`/`fetchCompleteTree` are I/O
 * (packages/github), and §3.2/§1.5 both require `domain` to stay pure with
 * no I/O dependency. This implementation takes already-fetched `FetchedTree`
 * values instead; the caller (apps/control) fetches all four trees via
 * packages/github first, then calls this pure function. Functionally
 * identical, just keeps the Functional Core boundary the design doc itself
 * insists on elsewhere.
 */

export interface TreeEntry {
	readonly path: string;
	readonly mode: string;
	readonly objectType: 'blob' | 'tree' | 'commit';
	readonly oid: Sha;
}

export interface FetchedTree {
	readonly rootSha: Sha;
	readonly entries: readonly TreeEntry[];
	/** blob content for entries that were actually fetched (not every entry needs content — only ones a diff touches). */
	readonly blobs: ReadonlyMap<Sha, Uint8Array>;
}

/** Minimal glob matcher: `**`=any incl. `/`, `*`=any excl. `/`, `?`=one char.
 * No external dependency — deliberately small, only what policy scope
 * `match:` patterns (design.md §9.1) need. */
export function matchesGlob(path: string, pattern: string): boolean {
	let regexStr = '^';
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i]!;
		if (c === '*' && pattern[i + 1] === '*') {
			regexStr += '.*';
			i++;
		} else if (c === '*') {
			regexStr += '[^/]*';
		} else if (c === '?') {
			regexStr += '[^/]';
		} else if ('.+^${}()|[]\\'.includes(c)) {
			regexStr += `\\${c}`;
		} else {
			regexStr += c;
		}
	}
	regexStr += '$';
	return new RegExp(regexStr).test(path);
}

export function extractScopeEntries(
	tree: FetchedTree,
	patterns: readonly string[]
): ScopeResultEntry[] {
	return tree.entries
		.filter((e) => e.objectType === 'blob' && patterns.some((p) => matchesGlob(e.path, p)))
		.map((e) => ({ path: e.path, objectType: e.objectType, mode: e.mode, oid: e.oid }));
}

/**
 * Scope-agnostic full-tree diff. Rename detection is content-confirmed only
 * (same oid at a different path) — design.md §8.4 explicitly forbids
 * similarity-score-only rename detection ("類似度スコアのみでの同一視を禁止"),
 * so anything not an exact oid match is emitted as delete+add instead of a
 * guessed rename.
 */
export function diffToCanonicalRecords(
	before: FetchedTree,
	after: FetchedTree
): CanonicalChangeRecord[] {
	const beforeByPath = new Map(before.entries.map((e) => [e.path, e]));
	const afterByPath = new Map(after.entries.map((e) => [e.path, e]));
	const beforeByOid = new Map(
		before.entries.filter((e) => e.objectType === 'blob').map((e) => [e.oid, e])
	);

	const records: CanonicalChangeRecord[] = [];
	const consumedBeforePaths = new Set<string>();

	for (const [path, afterEntry] of afterByPath) {
		const beforeEntry = beforeByPath.get(path);
		if (!beforeEntry) {
			// new path — a content-identical entry that vanished elsewhere is a
			// confirmed rename; otherwise this is a genuine add.
			const renameSource = beforeByOid.get(afterEntry.oid);
			if (
				renameSource &&
				!afterByPath.has(renameSource.path) &&
				!consumedBeforePaths.has(renameSource.path)
			) {
				consumedBeforePaths.add(renameSource.path);
				records.push({
					beforePath: renameSource.path,
					afterPath: path,
					changeKind: 'rename',
					objectType: afterEntry.objectType,
					modeBefore: renameSource.mode,
					modeAfter: afterEntry.mode,
					exactChangeBytes: after.blobs.get(afterEntry.oid) ?? new Uint8Array(0),
					binaryBeforeOid: null,
					binaryAfterOid: null
				});
				continue;
			}
			records.push({
				beforePath: null,
				afterPath: path,
				changeKind: 'add',
				objectType: afterEntry.objectType,
				modeBefore: null,
				modeAfter: afterEntry.mode,
				exactChangeBytes: after.blobs.get(afterEntry.oid) ?? new Uint8Array(0),
				binaryBeforeOid: null,
				binaryAfterOid: after.blobs.has(afterEntry.oid) ? null : afterEntry.oid
			});
			continue;
		}
		consumedBeforePaths.add(path);
		if (beforeEntry.oid !== afterEntry.oid) {
			records.push({
				beforePath: path,
				afterPath: path,
				changeKind: 'modify',
				objectType: afterEntry.objectType,
				modeBefore: beforeEntry.mode,
				modeAfter: afterEntry.mode,
				exactChangeBytes: after.blobs.get(afterEntry.oid) ?? new Uint8Array(0),
				binaryBeforeOid: null,
				binaryAfterOid: after.blobs.has(afterEntry.oid) ? null : afterEntry.oid
			});
		} else if (beforeEntry.mode !== afterEntry.mode) {
			records.push({
				beforePath: path,
				afterPath: path,
				changeKind: 'mode',
				objectType: afterEntry.objectType,
				modeBefore: beforeEntry.mode,
				modeAfter: afterEntry.mode,
				exactChangeBytes: new Uint8Array(0),
				binaryBeforeOid: null,
				binaryAfterOid: null
			});
		}
	}

	for (const [path, beforeEntry] of beforeByPath) {
		if (afterByPath.has(path) || consumedBeforePaths.has(path)) continue;
		records.push({
			beforePath: path,
			afterPath: null,
			changeKind: 'delete',
			objectType: beforeEntry.objectType,
			modeBefore: beforeEntry.mode,
			modeAfter: null,
			exactChangeBytes: new Uint8Array(0),
			binaryBeforeOid: null,
			binaryAfterOid: null
		});
	}

	return records;
}

export interface SyntheticResultTree {
	readonly entries: readonly TreeEntry[];
}

/** design.md §8.4's safe-side-invalidate table, as ApplyConflict kinds. */
export type ApplyConflict =
	| { readonly kind: 'PATH_MISSING_FOR_DELETE'; readonly path: string }
	| { readonly kind: 'AMBIGUOUS_RENAME'; readonly beforePath: string; readonly afterPath: string }
	| { readonly kind: 'SUBMODULE_GITLINK'; readonly path: string }
	| { readonly kind: 'LFS_POINTER'; readonly path: string };

const LFS_POINTER_PREFIX = 'version https://git-lfs';

function looksLikeLfsPointer(bytes: Uint8Array): boolean {
	const head = new TextDecoder().decode(bytes.slice(0, LFS_POINTER_PREFIX.length));
	return head === LFS_POINTER_PREFIX;
}

export interface DataOnlyApplyEngine {
	/**
	 * design.md §8.3: pure data-tree transform. No working directory, no
	 * checkout, no hooks, no submodule fetch, no LFS smudge, no external URL
	 * resolution — only the CanonicalChangeRecords produced by
	 * `diffToCanonicalRecords` and the target tree's already-fetched entries.
	 */
	apply(
		newBaseTree: FetchedTree,
		records: readonly CanonicalChangeRecord[]
	): Promise<Result<SyntheticResultTree, ApplyConflict>>;
}

export function createDataOnlyApplyEngine(): DataOnlyApplyEngine {
	return {
		async apply(newBaseTree, records) {
			const byPath = new Map(newBaseTree.entries.map((e) => [e.path, e]));

			for (const record of records) {
				if (record.objectType === 'commit') {
					return err({
						kind: 'SUBMODULE_GITLINK',
						path: record.afterPath ?? record.beforePath ?? ''
					});
				}
				if (record.exactChangeBytes.length > 0 && looksLikeLfsPointer(record.exactChangeBytes)) {
					return err({ kind: 'LFS_POINTER', path: record.afterPath ?? record.beforePath ?? '' });
				}

				switch (record.changeKind) {
					case 'add':
					case 'modify': {
						if (!record.afterPath) {
							return err({
								kind: 'AMBIGUOUS_RENAME',
								beforePath: record.beforePath ?? '',
								afterPath: ''
							});
						}
						const oid = record.binaryAfterOid ?? (await gitBlobOid(record.exactChangeBytes));
						byPath.set(record.afterPath, {
							path: record.afterPath,
							mode: record.modeAfter ?? '100644',
							objectType: record.objectType,
							oid
						});
						break;
					}
					case 'delete': {
						if (!record.beforePath || !byPath.has(record.beforePath)) {
							return err({ kind: 'PATH_MISSING_FOR_DELETE', path: record.beforePath ?? '' });
						}
						byPath.delete(record.beforePath);
						break;
					}
					case 'rename': {
						if (!record.beforePath || !record.afterPath || !byPath.has(record.beforePath)) {
							return err({
								kind: 'AMBIGUOUS_RENAME',
								beforePath: record.beforePath ?? '',
								afterPath: record.afterPath ?? ''
							});
						}
						const existing = byPath.get(record.beforePath)!;
						byPath.delete(record.beforePath);
						byPath.set(record.afterPath, {
							...existing,
							path: record.afterPath,
							mode: record.modeAfter ?? existing.mode
						});
						break;
					}
					case 'mode': {
						if (!record.afterPath) break;
						const existing = byPath.get(record.afterPath);
						if (existing) {
							byPath.set(record.afterPath, {
								...existing,
								mode: record.modeAfter ?? existing.mode
							});
						}
						break;
					}
				}
			}

			return ok({ entries: [...byPath.values()] });
		}
	};
}

/** design.md §8.3, verbatim shape. */
export interface ContextSafetyProof {
	readonly scopeId: ScopeId;
	readonly oldBaseSha: Sha;
	readonly oldHeadSha: Sha;
	readonly newBaseSha: Sha;
	readonly proofAlgorithm: 'deterministic-replay-v1';
	readonly oldScopeChangeDigest: Sha256Hex;
	readonly newScopeChangeDigestOfBaseDelta: Sha256Hex; // AT-04E判定用
	readonly replayedResultDigest: Sha256Hex | null; // indeterminateの場合はnull
	readonly newHeadResultDigest: Sha256Hex | null;
	readonly sensitivePathOverlap: boolean;
	readonly outcome: 'carried_forward' | 'requires_context_reapproval' | 'invalidate_indeterminate';
	readonly reason: string;
}

export interface EvaluateContextSafetyInput {
	readonly scopeId: ScopeId;
	readonly oldBaseSha: Sha;
	readonly oldHeadSha: Sha;
	readonly newBaseSha: Sha;
	readonly newHeadSha: Sha;
	readonly scopeMappingVersion: string;
	readonly scopePatterns: readonly string[];
	readonly sensitivePatterns: readonly string[];
}

export function hasSensitivePathOverlap(
	oldBase: FetchedTree,
	newBase: FetchedTree,
	sensitivePatterns: readonly string[]
): boolean {
	if (sensitivePatterns.length === 0) return false;
	const changed = diffToCanonicalRecords(oldBase, newBase);
	return changed.some((r) => {
		const paths = [r.beforePath, r.afterPath].filter((p): p is string => p !== null);
		return paths.some((p) => sensitivePatterns.some((pattern) => matchesGlob(p, pattern)));
	});
}

/** design.md §8.3–8.4. Pure function of four already-fetched trees + a
 * DataOnlyApplyEngine — see this file's top comment for why the signature
 * differs from the doc's illustrative code. */
export async function evaluateContextSafety(
	trees: { oldBase: FetchedTree; oldHead: FetchedTree; newBase: FetchedTree; newHead: FetchedTree },
	engine: DataOnlyApplyEngine,
	input: EvaluateContextSafetyInput
): Promise<ContextSafetyProof> {
	const oldRecords = diffToCanonicalRecords(trees.oldBase, trees.oldHead).filter((r) =>
		[r.beforePath, r.afterPath]
			.filter((p): p is string => p !== null)
			.some((p) => input.scopePatterns.some((pat) => matchesGlob(p, pat)))
	);
	const oldDigest = await computeScopeChangeDigest({
		digestAlgorithmVersion: 'scope-change-v1',
		scopeMappingVersion: input.scopeMappingVersion,
		scopeId: input.scopeId,
		records: oldRecords
	});
	const baseDeltaDigest = await computeScopeChangeDigest({
		digestAlgorithmVersion: 'scope-change-v1',
		scopeMappingVersion: input.scopeMappingVersion,
		scopeId: input.scopeId,
		records: diffToCanonicalRecords(trees.newBase, trees.newHead).filter((r) =>
			[r.beforePath, r.afterPath]
				.filter((p): p is string => p !== null)
				.some((p) => input.scopePatterns.some((pat) => matchesGlob(p, pat)))
		)
	});

	// 手順3: 決定論的data-only engineで新baseへ再適用
	const replay = await engine.apply(trees.newBase, oldRecords);
	if (!replay.ok) {
		return indeterminate(input, oldDigest, baseDeltaDigest, replay.error);
	}

	const replayedResultDigest = await computeScopeResultDigest(
		replay.value.entries.filter(
			(e) => e.objectType === 'blob' && input.scopePatterns.some((p) => matchesGlob(e.path, p))
		)
	);
	const newHeadResultDigest = await computeScopeResultDigest(
		extractScopeEntries(trees.newHead, input.scopePatterns)
	);

	if (replayedResultDigest !== newHeadResultDigest) {
		return invalidated(
			input,
			oldDigest,
			baseDeltaDigest,
			'result_digest_mismatch: 新base上への再適用結果がnew headと一致しない'
		);
	}

	const overlap = hasSensitivePathOverlap(trees.oldBase, trees.newBase, input.sensitivePatterns);

	return {
		scopeId: input.scopeId,
		oldBaseSha: input.oldBaseSha,
		oldHeadSha: input.oldHeadSha,
		newBaseSha: input.newBaseSha,
		proofAlgorithm: 'deterministic-replay-v1',
		oldScopeChangeDigest: oldDigest,
		newScopeChangeDigestOfBaseDelta: baseDeltaDigest,
		replayedResultDigest,
		newHeadResultDigest,
		sensitivePathOverlap: overlap,
		outcome: overlap ? 'requires_context_reapproval' : 'carried_forward',
		reason: overlap
			? 'new baseが承認対象scopeと重なる高感度pathを変更したため、context再承認を要求する'
			: 'scope内変更が同一であり、新base上の適用結果がnew headと一致した'
	};
}

function indeterminate(
	input: EvaluateContextSafetyInput,
	oldDigest: Sha256Hex,
	baseDeltaDigest: Sha256Hex,
	conflict: ApplyConflict
): ContextSafetyProof {
	return {
		scopeId: input.scopeId,
		oldBaseSha: input.oldBaseSha,
		oldHeadSha: input.oldHeadSha,
		newBaseSha: input.newBaseSha,
		proofAlgorithm: 'deterministic-replay-v1',
		oldScopeChangeDigest: oldDigest,
		newScopeChangeDigestOfBaseDelta: baseDeltaDigest,
		replayedResultDigest: null,
		newHeadResultDigest: null,
		sensitivePathOverlap: false,
		outcome: 'invalidate_indeterminate',
		reason: `安全側で失効: ${conflict.kind}`
	};
}

function invalidated(
	input: EvaluateContextSafetyInput,
	oldDigest: Sha256Hex,
	baseDeltaDigest: Sha256Hex,
	reason: string
): ContextSafetyProof {
	return {
		scopeId: input.scopeId,
		oldBaseSha: input.oldBaseSha,
		oldHeadSha: input.oldHeadSha,
		newBaseSha: input.newBaseSha,
		proofAlgorithm: 'deterministic-replay-v1',
		oldScopeChangeDigest: oldDigest,
		newScopeChangeDigestOfBaseDelta: baseDeltaDigest,
		replayedResultDigest: null,
		newHeadResultDigest: null,
		sensitivePathOverlap: false,
		outcome: 'invalidate_indeterminate',
		reason
	};
}
