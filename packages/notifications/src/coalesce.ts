/**
 * design.md §14.3/FR-101/AT-22/AT-40: notifications sharing a
 * `root_cause_fingerprint` (`coalesceKey`) are broadcast once, not once per
 * affected PR. This package stays DB-free (see deno.jsonc's top comment):
 * `draftNotification` builds the row a caller inserts via packages/postgres,
 * and `groupForDispatch` is a pure grouping/window function over rows the
 * caller already loaded — no I/O happens in this file.
 */

export type NotificationCategory = 'blocker' | 'action_required' | 'informational';

export interface DraftNotificationInput {
	readonly decisionId: string;
	readonly audience: string;
	readonly reasonCode: string;
	readonly coalesceKey: string;
	readonly category: NotificationCategory;
}

export function draftNotification(input: DraftNotificationInput): DraftNotificationInput {
	return input;
}

export interface NotificationRecord extends DraftNotificationInput {
	readonly id: number;
	readonly dispatchedAt: Date | null;
	readonly createdAt: Date;
}

/**
 * Groups undispatched rows by `coalesceKey` and returns only the groups
 * whose earliest member has waited at least `coalesceWindowMs` — i.e. due
 * for a single combined dispatch now. Groups still inside the window are
 * omitted (the caller checks again on the next Cron tick / outbox drain),
 * so a late-arriving row in the same window still gets folded in instead of
 * triggering a second, redundant broadcast.
 */
export function groupForDispatch(
	pending: readonly NotificationRecord[],
	coalesceWindowMs: number,
	now: Date = new Date()
): ReadonlyMap<string, readonly NotificationRecord[]> {
	const byKey = new Map<string, NotificationRecord[]>();
	for (const record of pending) {
		if (record.dispatchedAt !== null) continue;
		const group = byKey.get(record.coalesceKey);
		if (group) group.push(record);
		else byKey.set(record.coalesceKey, [record]);
	}

	const due = new Map<string, readonly NotificationRecord[]>();
	for (const [key, group] of byKey) {
		const earliest = group.reduce(
			(min, r) => (r.createdAt.getTime() < min ? r.createdAt.getTime() : min),
			group[0]!.createdAt.getTime()
		);
		if (now.getTime() - earliest >= coalesceWindowMs) due.set(key, group);
	}
	return due;
}
