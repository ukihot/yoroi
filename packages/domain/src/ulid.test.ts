import { assertEquals, assertMatch, assertNotEquals } from '@std/assert';
import { generateDecisionId, generateOperationId, generateUlid } from './ulid.ts';

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

Deno.test('generateUlid: 26桁のCrockford base32文字列を返す', () => {
	assertMatch(generateUlid(), ULID_PATTERN);
});

Deno.test('generateUlid: 連続呼び出しで異なる値になる', () => {
	const a = generateUlid();
	const b = generateUlid();
	assertNotEquals(a, b);
});

Deno.test('generateUlid: 同じtimestampを渡してもrandom部分により毎回変わる', () => {
	const now = Date.now();
	const a = generateUlid(now);
	const b = generateUlid(now);
	assertEquals(a.slice(0, 10), b.slice(0, 10)); // timestamp部分は一致
	assertNotEquals(a, b); // random部分は一致しない(確率的にほぼ確実)
});

Deno.test(
	'generateOperationId/generateDecisionId: ULID形式を満たす（packages/evidenceのDecisionEnvelopeSchemaと同じpattern）',
	() => {
		assertMatch(generateOperationId(), ULID_PATTERN);
		assertMatch(generateDecisionId(), ULID_PATTERN);
	}
);
