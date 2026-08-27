import { assertEquals } from '@std/assert';
import {
	createDataOnlyApplyEngine,
	diffToCanonicalRecords,
	evaluateContextSafety,
	type FetchedTree,
	matchesGlob,
	type TreeEntry
} from './context-proof.ts';
import { gitBlobOid } from './scope-digest.ts';
import { scopeId, sha } from './ids.ts';

async function blobEntry(
	path: string,
	content: string,
	mode = '100644'
): Promise<{ entry: TreeEntry; content: Uint8Array }> {
	const bytes = new TextEncoder().encode(content);
	const oid = await gitBlobOid(bytes);
	return { entry: { path, mode, objectType: 'blob', oid }, content: bytes };
}

function tree(
	rootSha: string,
	files: Array<{ entry: TreeEntry; content: Uint8Array }>
): FetchedTree {
	return {
		rootSha: sha(rootSha),
		entries: files.map((f) => f.entry),
		blobs: new Map(files.map((f) => [f.entry.oid, f.content]))
	};
}

Deno.test('matchesGlob: **と*とliteralの基本動作', () => {
	assertEquals(matchesGlob('src/auth/session.ts', 'src/auth/**'), true);
	assertEquals(matchesGlob('src/auth/session.ts', 'src/*.ts'), false);
	assertEquals(matchesGlob('src/session.ts', 'src/*.ts'), true);
	assertEquals(matchesGlob('src/session.ts', 'src/session.ts'), true);
});

Deno.test('diffToCanonicalRecords: add/modify/delete/renameを検出する', async () => {
	const a1 = await blobEntry('a.ts', 'unchanged');
	const b1 = await blobEntry('b.ts', 'old content');
	const before = tree('base1', [a1, b1]);

	const a2 = a1; // unchanged
	const b2 = await blobEntry('b.ts', 'new content'); // modified
	const c2 = await blobEntry('c.ts', 'brand new'); // added
	const renamed = await blobEntry('renamed.ts', 'old content'); // same content as b1, different path elsewhere too — but b1 also modified, so this is a genuine rename of some *other* unchanged file
	const d1 = await blobEntry('d.ts', 'moved content');
	const before2 = tree('base2', [d1]);
	const after2 = tree('head2', [{ entry: { ...d1.entry, path: 'moved.ts' }, content: d1.content }]);

	const records = diffToCanonicalRecords(before, tree('head1', [a2, b2, c2, renamed]));
	const kinds = new Map(records.map((r) => [r.afterPath ?? r.beforePath, r.changeKind]));
	assertEquals(kinds.get('b.ts'), 'modify');
	assertEquals(kinds.get('c.ts'), 'add');
	assertEquals(kinds.get('renamed.ts'), 'add'); // content matches b1's *old* content, but b1 itself still exists at its own path post-diff... not a rename source
	assertEquals(kinds.has('a.ts'), false); // unchanged: no record

	const renameRecords = diffToCanonicalRecords(before2, after2);
	assertEquals(renameRecords.length, 1);
	const [renameRecord] = renameRecords;
	assertEquals(renameRecord?.changeKind, 'rename');
	assertEquals(renameRecord?.beforePath, 'd.ts');
	assertEquals(renameRecord?.afterPath, 'moved.ts');
});

Deno.test('evaluateContextSafety: scope外のbaseリベースはcarried_forwardになる', async () => {
	const scopeFile = await blobEntry('src/scope/x.ts', 'scope content v1');
	const outOfScope1 = await blobEntry('README.md', 'v1');
	const oldBase = tree('oldBase', [outOfScope1, scopeFile]);
	const oldHead = tree('oldHead', [outOfScope1, scopeFile]); // no change to scope in old revision

	const outOfScope2 = await blobEntry('README.md', 'v2 — unrelated base churn');
	const newBase = tree('newBase', [outOfScope2, scopeFile]);
	const newHead = tree('newHead', [outOfScope2, scopeFile]); // scope untouched by rebase either

	const proof = await evaluateContextSafety(
		{ oldBase, oldHead, newBase, newHead },
		createDataOnlyApplyEngine(),
		{
			scopeId: scopeId('scope'),
			oldBaseSha: sha('oldBase'),
			oldHeadSha: sha('oldHead'),
			newBaseSha: sha('newBase'),
			newHeadSha: sha('newHead'),
			scopeMappingVersion: 'v1',
			scopePatterns: ['src/scope/**'],
			sensitivePatterns: []
		}
	);

	assertEquals(proof.outcome, 'carried_forward');
});

Deno.test(
	'evaluateContextSafety: submoduleを含む変更はindeterminateへ安全側失効する (§8.4 AT-04C)',
	async () => {
		const gitlink: TreeEntry = {
			path: 'vendor/lib',
			mode: '160000',
			objectType: 'commit',
			oid: sha('c'.repeat(40))
		};
		const oldBase = tree('oldBase', []);
		const oldHead = { ...tree('oldHead', []), entries: [gitlink] } satisfies FetchedTree;
		const newBase = tree('newBase', []);
		const newHead = tree('newHead', []);

		const proof = await evaluateContextSafety(
			{ oldBase, oldHead, newBase, newHead },
			createDataOnlyApplyEngine(),
			{
				scopeId: scopeId('scope'),
				oldBaseSha: sha('oldBase'),
				oldHeadSha: sha('oldHead'),
				newBaseSha: sha('newBase'),
				newHeadSha: sha('newHead'),
				scopeMappingVersion: 'v1',
				scopePatterns: ['vendor/**'],
				sensitivePatterns: []
			}
		);

		assertEquals(proof.outcome, 'invalidate_indeterminate');
		assertEquals(proof.replayedResultDigest, null);
	}
);

Deno.test('evaluateContextSafety: 高感度path重複はrequires_context_reapprovalになる', async () => {
	const scopeFile = await blobEntry('src/scope/x.ts', 'unchanged everywhere');
	const oldHead = tree('oldHead', [scopeFile]);

	const sensitiveOld = await blobEntry('src/auth/session.ts', 'v1');
	const sensitiveNew = await blobEntry('src/auth/session.ts', 'v2 — changed by base');
	const newBase = tree('newBase', [scopeFile, sensitiveNew]);
	const newHead = tree('newHead', [scopeFile, sensitiveNew]);

	const proof = await evaluateContextSafety(
		{ oldBase: tree('oldBase2', [scopeFile, sensitiveOld]), oldHead, newBase, newHead },
		createDataOnlyApplyEngine(),
		{
			scopeId: scopeId('scope'),
			oldBaseSha: sha('oldBase'),
			oldHeadSha: sha('oldHead'),
			newBaseSha: sha('newBase'),
			newHeadSha: sha('newHead'),
			scopeMappingVersion: 'v1',
			scopePatterns: ['src/scope/**'],
			sensitivePatterns: ['src/auth/**']
		}
	);

	assertEquals(proof.outcome, 'requires_context_reapproval');
});
