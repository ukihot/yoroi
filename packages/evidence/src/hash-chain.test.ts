import { assertEquals } from '@std/assert';
import {
	type ChainedDecisionEventRow,
	computeRowHash,
	type DecisionEventHashInput,
	GENESIS_HASH,
	verifyChain
} from './hash-chain.ts';

function fields(overrides: Partial<DecisionEventHashInput> = {}): DecisionEventHashInput {
	return {
		operationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
		repoId: 'org/repo',
		prNumber: 42,
		actorStableId: 'user-1',
		operation: 'merge',
		fromState: 'MERGING',
		toState: 'MERGED',
		reasonCode: 'gate_passed',
		result: 'success',
		evidence: { candidateSha: 'a'.repeat(40) },
		occurredAt: '2026-08-26T00:00:00.000Z',
		...overrides
	};
}

async function buildChain(count: number): Promise<ChainedDecisionEventRow[]> {
	const rows: ChainedDecisionEventRow[] = [];
	let prevHash = GENESIS_HASH;
	for (let i = 0; i < count; i++) {
		const rowFields = fields({ reasonCode: `event-${i}` });
		const rowHash = await computeRowHash(prevHash, rowFields);
		rows.push({ ...rowFields, prevHash, rowHash });
		prevHash = rowHash;
	}
	return rows;
}

Deno.test('computeRowHash: 同じ入力なら決定論的に同じhashになる', async () => {
	const a = await computeRowHash(GENESIS_HASH, fields());
	const b = await computeRowHash(GENESIS_HASH, fields());
	assertEquals(a, b);
});

Deno.test('computeRowHash: prevHashが違えば結果も変わる（連鎖の意味）', async () => {
	const a = await computeRowHash(GENESIS_HASH, fields());
	const b = await computeRowHash('f'.repeat(64), fields());
	assertEquals(a === b, false);
});

Deno.test('verifyChain: 正しく連鎖したチェーンは検証を通る', async () => {
	const chain = await buildChain(5);
	const result = await verifyChain(chain);
	assertEquals(result.ok, true);
});

Deno.test('verifyChain: 途中のrowを改ざんするとその地点で検知される (AT-19)', async () => {
	const chain = await buildChain(5);
	const tampered = chain.map((row, i) => (i === 2 ? { ...row, result: 'tampered' } : row));
	const result = await verifyChain(tampered);
	assertEquals(result.ok, false);
	if (result.ok) return;
	assertEquals(result.brokenAtIndex, 2);
});

Deno.test('verifyChain: rowを削除して詰めると次のrowのprev_hashが合わず検知される', async () => {
	const chain = await buildChain(5);
	const withGap = [chain[0]!, chain[1]!, chain[3]!, chain[4]!]; // 2番目を削除
	const result = await verifyChain(withGap);
	assertEquals(result.ok, false);
	if (result.ok) return;
	assertEquals(result.brokenAtIndex, 2);
});

Deno.test('verifyChain: 空配列は検証を通る（何もないので破損もない）', async () => {
	const result = await verifyChain([]);
	assertEquals(result.ok, true);
});

Deno.test('verifyChain: rowを並べ替えるとprev_hashの連鎖が崩れて検知される', async () => {
	const chain = await buildChain(3);
	const reordered = [chain[0]!, chain[2]!, chain[1]!];
	const result = await verifyChain(reordered);
	assertEquals(result.ok, false);
});
