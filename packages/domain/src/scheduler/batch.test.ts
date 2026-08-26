import { assertEquals } from "@std/assert";
import { circuitBreakerKey, findInteractionPair, isolateFailureSet, type PrId } from "./batch.ts";

Deno.test("isolateFailureSet: 要素が1つ以下ならそのまま返す", async () => {
	assertEquals(await isolateFailureSet([], () => Promise.resolve("fail")), []);
	assertEquals(await isolateFailureSet(["a"], () => Promise.resolve("fail")), ["a"]);
});

Deno.test("isolateFailureSet: fail/passなら失敗した左半分だけを再帰的に絞り込む", async () => {
	const batch: PrId[] = ["a", "b"];
	const result = await isolateFailureSet(batch, (subset) => {
		if (subset.length === 2) return Promise.resolve("fail");
		return Promise.resolve(subset[0] === "a" ? "fail" : "pass");
	});
	assertEquals(result, ["a"]);
});

Deno.test("isolateFailureSet: pass/failなら失敗した右半分だけを絞り込む", async () => {
	const batch: PrId[] = ["a", "b"];
	const result = await isolateFailureSet(batch, (subset) => {
		if (subset.length === 2) return Promise.resolve("fail");
		return Promise.resolve(subset[0] === "b" ? "fail" : "pass");
	});
	assertEquals(result, ["b"]);
});

Deno.test("isolateFailureSet: fail/failなら両方を再帰的に絞り込み結合する", async () => {
	const batch: PrId[] = ["a", "b", "c", "d"];
	// 各単体は"a"と"c"だけが真の原因
	const result = await isolateFailureSet(batch, (subset) => {
		if (subset.length >= 2) return Promise.resolve("fail");
		return Promise.resolve(subset[0] === "a" || subset[0] === "c" ? "fail" : "pass");
	});
	assertEquals(new Set(result), new Set(["a", "c"]));
});

Deno.test("isolateFailureSet: pass/passなら相互作用としてfindInteractionPairに委ねる", async () => {
	const batch: PrId[] = ["a", "b"];
	// 単体はどちらもpassだが、組合せはfail
	const result = await isolateFailureSet(batch, (subset) => {
		return Promise.resolve(subset.length === 2 ? "fail" : "pass");
	});
	assertEquals(new Set(result), new Set(["a", "b"]));
});

Deno.test("findInteractionPair: 失敗する組を発見したら返す", async () => {
	const result = await findInteractionPair(["a", "x"], ["b", "y"], (subset) => {
		const isTarget = subset.includes("x") && subset.includes("y");
		return Promise.resolve(isTarget ? "fail" : "pass");
	});
	assertEquals(result, ["x", "y"]);
});

Deno.test("findInteractionPair: 相互作用が見つからなければ両方をそのまま返す", async () => {
	const result = await findInteractionPair(["a"], ["b"], () => Promise.resolve("pass"));
	assertEquals(result, ["a", "b"]);
});

Deno.test("circuitBreakerKey: batch fingerprintとfailure fingerprintを結合する", () => {
	assertEquals(circuitBreakerKey("batch-1", "failure-1"), "batch-1:failure-1");
});
