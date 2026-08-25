import { assertEquals } from "@std/assert";
import { formatRelativeJa, minutesSince, toEta } from "./format.ts";

Deno.test("minutesSince floors elapsed minutes and never goes negative", () => {
	const now = new Date("2026-08-25T12:00:00Z");
	assertEquals(minutesSince(new Date("2026-08-25T11:30:00Z"), now), 30);
	assertEquals(minutesSince(new Date("2026-08-25T11:59:30Z"), now), 0);
	// clock skew / a date in the future must not produce a negative duration
	assertEquals(minutesSince(new Date("2026-08-25T12:05:00Z"), now), 0);
});

Deno.test("formatRelativeJa picks the coarsest applicable unit", () => {
	const now = new Date("2026-08-25T12:00:00Z");
	assertEquals(formatRelativeJa(new Date("2026-08-25T11:59:40Z"), now), "たった今");
	assertEquals(formatRelativeJa(new Date("2026-08-25T11:45:00Z"), now), "15分前");
	assertEquals(formatRelativeJa(new Date("2026-08-25T06:20:00Z"), now), "5時間40分前");
	assertEquals(formatRelativeJa(new Date("2026-08-24T10:00:00Z"), now), "1日2時間前");
});

Deno.test("toEta returns null unless from/to/confidence are all present", () => {
	const from = new Date("2026-08-25T17:00:00Z");
	const to = new Date("2026-08-25T17:30:00Z");
	assertEquals(toEta(null, to, "high"), null);
	assertEquals(toEta(from, null, "high"), null);
	assertEquals(toEta(from, to, null), null);
	assertEquals(toEta(from, to, "high"), {
		from: from.toISOString(),
		to: to.toISOString(),
		confidence: "high",
	});
});
