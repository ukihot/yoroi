import { assertEquals } from '@std/assert';
import { type Lane, rebuildAfterEjection } from './lane.ts';
import { sha } from '../ids.ts';

function lane(laneId: string, headCount: number, overrides: Partial<Lane> = {}): Lane {
	return {
		laneId,
		cumulativeHeads: Array.from({ length: headCount }, (_, i) => sha(`${'a'.repeat(39)}${i}`)),
		candidateSha: sha('c'.repeat(40)),
		status: 'passed',
		...overrides
	};
}

Deno.test('rebuildAfterEjection: ejectedIndex以前のlaneは変更されない', () => {
	const lanes = [lane('A', 1), lane('B', 2), lane('C', 3)];
	const rebuilt = rebuildAfterEjection(lanes, 1);
	assertEquals(rebuilt[0], lanes[0]);
	assertEquals(rebuilt[1], lanes[1]);
});

Deno.test(
	'rebuildAfterEjection: ejectedIndexより後のlaneはcandidateSha/statusがリセットされる',
	() => {
		const lanes = [lane('A', 1), lane('B', 2), lane('C', 3)];
		const rebuilt = rebuildAfterEjection(lanes, 1);
		assertEquals(rebuilt[2]?.candidateSha, null);
		assertEquals(rebuilt[2]?.status, 'pending');
	}
);

Deno.test(
	'rebuildAfterEjection: ejectedIndex位置のheadが後続laneのcumulativeHeadsから除かれる',
	() => {
		const lanes = [lane('A', 1), lane('B', 2), lane('C', 3)];
		const rebuilt = rebuildAfterEjection(lanes, 1);
		assertEquals(rebuilt[2]?.cumulativeHeads.length, 2);
	}
);

Deno.test('rebuildAfterEjection: 空配列はそのまま空配列', () => {
	assertEquals(rebuildAfterEjection([], 0), []);
});
