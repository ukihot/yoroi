import { assertEquals, assertThrows } from "@std/assert";
import {
	buildEvidenceBundle,
	type EvidenceBundleRow,
	InMemoryEvidenceSink,
	NullEvidenceSink,
} from "./export.ts";

function row(seq: number, overrides: Partial<EvidenceBundleRow> = {}): EvidenceBundleRow {
	return {
		seq,
		operationId: null,
		repoId: "org/repo",
		prNumber: null,
		actorStableId: null,
		operation: "merge",
		fromState: null,
		toState: null,
		reasonCode: "gate_passed",
		result: "success",
		evidence: {},
		occurredAt: "2026-08-26T00:00:00.000Z",
		prevHash: "0".repeat(64),
		rowHash: "1".repeat(64),
		...overrides,
	};
}

Deno.test("buildEvidenceBundle: 連続したseq範囲からbundleを作れる", () => {
	const bundle = buildEvidenceBundle("bundle-1", [row(1), row(2), row(3)]);
	assertEquals(bundle.fromSeq, 1);
	assertEquals(bundle.toSeq, 3);
	assertEquals(bundle.rows.length, 3);
});

Deno.test("buildEvidenceBundle: 入力順序に関わらずseq昇順に並べ替える", () => {
	const bundle = buildEvidenceBundle("bundle-1", [row(3), row(1), row(2)]);
	assertEquals(bundle.rows.map((r) => r.seq), [1, 2, 3]);
});

Deno.test("buildEvidenceBundle: 空配列はerror", () => {
	assertThrows(() => buildEvidenceBundle("bundle-1", []));
});

Deno.test("buildEvidenceBundle: seqに欠番があるとerror（範囲の完全性を保証する）", () => {
	assertThrows(() => buildEvidenceBundle("bundle-1", [row(1), row(3)]));
});

Deno.test("NullEvidenceSink: exportは何もせず正常終了する", async () => {
	const sink = new NullEvidenceSink();
	const bundle = buildEvidenceBundle("bundle-1", [row(1)]);
	await sink.export(bundle);
});

Deno.test("InMemoryEvidenceSink: exportしたbundleを保持する（テスト用）", async () => {
	const sink = new InMemoryEvidenceSink();
	const bundle = buildEvidenceBundle("bundle-1", [row(1), row(2)]);
	await sink.export(bundle);
	assertEquals(sink.exported.length, 1);
	assertEquals(sink.exported[0], bundle);
});
