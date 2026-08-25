import type { Eta, EtaConfidence } from "../domain/types.ts";

/** Minutes elapsed between `date` and `now`, floored, never negative. */
export function minutesSince(date: Date, now: Date = new Date()): number {
	return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
}

/**
 * Same relative-time style the original mock used verbatim (e.g. "5時間40分前",
 * "1日2時間前") — see `src/lib/server/yoroi/mock-control-api.ts` in the console
 * app. Kept Japanese-only rather than locale-aware: the console's own doc
 * comment on that file already treats this kind of sample-shaped display text
 * as not going through Paraglide, and `MyWorkReviewItem.waitingSince` is typed
 * as a plain display string, not an ISO timestamp — building a real
 * locale-aware formatter is out of scope here (see plan notes / doc/design.md §22).
 */
export function formatRelativeJa(date: Date, now: Date = new Date()): string {
	const totalMinutes = minutesSince(date, now);
	const days = Math.floor(totalMinutes / (60 * 24));
	const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
	const minutes = totalMinutes % 60;
	if (days > 0) return `${days}日${hours}時間前`;
	if (hours > 0) return `${hours}時間${minutes}分前`;
	if (minutes > 0) return `${minutes}分前`;
	return "たった今";
}

export function toEta(
	from: Date | null,
	to: Date | null,
	confidence: string | null,
): Eta | null {
	if (!from || !to || !confidence) return null;
	return {
		from: from.toISOString(),
		to: to.toISOString(),
		confidence: confidence as EtaConfidence,
	};
}
