import type { FetchedTree, Sha, TreeEntry } from '@yoroi/domain';
import type { GitHubAdapter, RepoRef, TreeEntryResponse } from './adapter.ts';

function toTreeEntry(e: TreeEntryResponse): TreeEntry {
	return { path: e.path, mode: e.mode, objectType: e.type, oid: e.sha };
}

/**
 * design.md §8.1, AT-39: a recursive tree response with `truncated: true`
 * must not be trusted for completeness — subtrees are fetched individually
 * until the full entry set is known. `tree`-type entries themselves are
 * directory markers, not files, and are dropped from the merged result
 * either way (only blobs and `commit` gitlinks matter for diffing).
 */
export async function fetchCompleteTree(
	gh: GitHubAdapter,
	repo: RepoRef,
	rootSha: Sha
): Promise<FetchedTree> {
	const root = await gh.getTreeRecursive(repo, rootSha);
	const nonTreeEntries = root.entries.filter((e) => e.type !== 'tree').map(toTreeEntry);

	if (!root.truncated) {
		return { rootSha, entries: nonTreeEntries, blobs: new Map() };
	}

	const merged = new Map<string, TreeEntry>(nonTreeEntries.map((e) => [e.path, e]));
	const subtreeEntries = root.entries.filter((e) => e.type === 'tree');
	for (const subtreeEntry of subtreeEntries) {
		const sub = await fetchCompleteTree(gh, repo, subtreeEntry.sha);
		for (const entry of sub.entries) {
			const fullPath = `${subtreeEntry.path}/${entry.path}`;
			merged.set(fullPath, { ...entry, path: fullPath });
		}
	}
	return { rootSha, entries: [...merged.values()], blobs: new Map() };
}

/** Fetches blob content only for the given paths (not the whole tree) —
 * `diffToCanonicalRecords`/context-proof only need bytes for paths that
 * actually changed, and a repo-wide blob fetch would be wasteful and slow. */
export async function fetchBlobsForPaths(
	gh: GitHubAdapter,
	repo: RepoRef,
	tree: FetchedTree,
	paths: readonly string[]
): Promise<FetchedTree> {
	const byPath = new Map(tree.entries.map((e) => [e.path, e]));
	const blobs = new Map(tree.blobs);
	for (const path of paths) {
		const entry = byPath.get(path);
		if (!entry || entry.objectType !== 'blob' || blobs.has(entry.oid)) continue;
		blobs.set(entry.oid, await gh.getBlob(repo, entry.oid));
	}
	return { ...tree, blobs };
}
