import { assertEquals } from "@std/assert";
import { draftNotification, groupForDispatch, type NotificationRecord } from "./coalesce.ts";

function record(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
	return {
		id: 1,
		decisionId: "dec-1",
		audience: "42",
		reasonCode: "infra_failure",
		coalesceKey: "fingerprint-a",
		category: "blocker",
		dispatchedAt: null,
		createdAt: new Date("2026-08-26T00:00:00.000Z"),
		...overrides,
	};
}

Deno.test("draftNotification: 入力をそのままdraftとして返す（DB IOなし）", () => {
	const input = {
		decisionId: "d1",
		audience: "1",
		reasonCode: "r",
		coalesceKey: "k",
		category: "informational" as const,
	};
	assertEquals(draftNotification(input), input);
});

Deno.test("groupForDispatch: coalesce windowを過ぎたgroupだけをdueとして返す", () => {
	const now = new Date("2026-08-26T00:11:00.000Z");
	const pending = [record({ id: 1 }), record({ id: 2 })];
	const due = groupForDispatch(pending, 10 * 60_000, now);
	assertEquals(due.size, 1);
	assertEquals(due.get("fingerprint-a")?.length, 2);
});

Deno.test("groupForDispatch: window内のgroupはdueにならない", () => {
	const now = new Date("2026-08-26T00:05:00.000Z");
	const pending = [record({ id: 1 })];
	const due = groupForDispatch(pending, 10 * 60_000, now);
	assertEquals(due.size, 0);
});

Deno.test("groupForDispatch: 既にdispatch済みのrowは無視される", () => {
	const now = new Date("2026-08-26T01:00:00.000Z");
	const pending = [record({ id: 1, dispatchedAt: new Date("2026-08-26T00:01:00.000Z") })];
	const due = groupForDispatch(pending, 10 * 60_000, now);
	assertEquals(due.size, 0);
});

Deno.test("groupForDispatch: coalesceKeyが違えば別groupになる", () => {
	const now = new Date("2026-08-26T01:00:00.000Z");
	const pending = [
		record({ id: 1, coalesceKey: "a" }),
		record({ id: 2, coalesceKey: "b" }),
	];
	const due = groupForDispatch(pending, 1_000, now);
	assertEquals(due.size, 2);
});
