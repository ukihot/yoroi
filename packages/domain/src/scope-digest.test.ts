import { assertEquals, assertNotEquals } from '@std/assert';
import fc from 'fast-check';
import {
	type CanonicalChangeRecord,
	computeScopeChangeDigest,
	computeScopeResultDigest,
	gitBlobOid
} from './scope-digest.ts';
import { scopeId } from './ids.ts';

function record(overrides: Partial<CanonicalChangeRecord> = {}): CanonicalChangeRecord {
	return {
		beforePath: 'src/a.ts',
		afterPath: 'src/a.ts',
		changeKind: 'modify',
		objectType: 'blob',
		modeBefore: '100644',
		modeAfter: '100644',
		exactChangeBytes: new TextEncoder().encode('hello'),
		binaryBeforeOid: null,
		binaryAfterOid: null,
		...overrides
	};
}

const recordArb: fc.Arbitrary<CanonicalChangeRecord> = fc.record({
	beforePath: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
	afterPath: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
	changeKind: fc.constantFrom('add', 'delete', 'modify', 'rename', 'mode'),
	objectType: fc.constantFrom('blob', 'tree', 'commit'),
	modeBefore: fc.option(fc.constantFrom('100644', '100755'), { nil: null }),
	modeAfter: fc.option(fc.constantFrom('100644', '100755'), { nil: null }),
	exactChangeBytes: fc.uint8Array({ maxLength: 32 }),
	binaryBeforeOid: fc.constant(null),
	binaryAfterOid: fc.constant(null)
});

Deno.test('ScopeChangeDigestは要素順序に依存しない (design.md §20.2)', async () => {
	await fc.assert(
		fc.asyncProperty(fc.array(recordArb, { maxLength: 8 }), async (records) => {
			const base = {
				digestAlgorithmVersion: 'scope-change-v1' as const,
				scopeMappingVersion: 'v1',
				scopeId: scopeId('payments-core')
			};
			const d1 = await computeScopeChangeDigest({ ...base, records });
			const d2 = await computeScopeChangeDigest({ ...base, records: [...records].reverse() });
			assertEquals(d1, d2);
		})
	);
});

Deno.test('null pathと空文字pathは異なるdigestになる（プレフィックス衝突なし）', async () => {
	const base = {
		digestAlgorithmVersion: 'scope-change-v1' as const,
		scopeMappingVersion: 'v1',
		scopeId: scopeId('s')
	};
	const withNull = await computeScopeChangeDigest({
		...base,
		records: [record({ beforePath: null })]
	});
	const withEmpty = await computeScopeChangeDigest({
		...base,
		records: [record({ beforePath: '' })]
	});
	assertNotEquals(withNull, withEmpty);
});

Deno.test('whitespaceの違いは異なるdigestになる (design.md §8.5 AT-04D)', async () => {
	const base = {
		digestAlgorithmVersion: 'scope-change-v1' as const,
		scopeMappingVersion: 'v1',
		scopeId: scopeId('s')
	};
	const a = await computeScopeChangeDigest({
		...base,
		records: [record({ exactChangeBytes: new TextEncoder().encode('const x = 1;') })]
	});
	const b = await computeScopeChangeDigest({
		...base,
		records: [record({ exactChangeBytes: new TextEncoder().encode('const x = 1; ') })]
	});
	assertNotEquals(a, b);
});

Deno.test('computeScopeResultDigestも要素順序に依存しない', async () => {
	const entries = [
		{
			path: 'b.ts',
			objectType: 'blob',
			mode: '100644',
			oid: await gitBlobOid(new TextEncoder().encode('b'))
		},
		{
			path: 'a.ts',
			objectType: 'blob',
			mode: '100644',
			oid: await gitBlobOid(new TextEncoder().encode('a'))
		}
	];
	const d1 = await computeScopeResultDigest(entries);
	const d2 = await computeScopeResultDigest([...entries].reverse());
	assertEquals(d1, d2);
});

Deno.test('gitBlobOidは既知のgit blob shaと一致する', async () => {
	// `git hash-object` for an empty file is well-known: e69de29bb2d1d6434b8b29ae775ad8c2e48c5391
	const oid = await gitBlobOid(new Uint8Array(0));
	assertEquals(oid, 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});
