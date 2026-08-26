/**
 * design.md §7.1's `minimalEventFacts` — what actually gets written into
 * `work_outbox.payload` (FR-002: minimize retained content, no full raw
 * webhook body). `apps/control/src/routes/webhook.ts` builds these at
 * ingestion time; every outbox handler in `apps/control/src/worker/`
 * re-parses them via `parseEventFacts` instead of trusting `unknown` jsonb
 * directly.
 */
export interface MinimalEventFacts {
	readonly eventType: string;
	readonly action: string | null;
	readonly repoFullName: string | null;
	readonly pullRequestNumber: number | null;
	readonly isIssueComment: boolean;
	readonly commentBody: string | null;
	readonly commentActorNodeId: string | null;
}

export function parseEventFacts(payload: unknown): MinimalEventFacts {
	const p = (payload ?? {}) as Partial<MinimalEventFacts>;
	return {
		eventType: p.eventType ?? "",
		action: p.action ?? null,
		repoFullName: p.repoFullName ?? null,
		pullRequestNumber: p.pullRequestNumber ?? null,
		isIssueComment: p.isIssueComment ?? false,
		commentBody: p.commentBody ?? null,
		commentActorNodeId: p.commentActorNodeId ?? null,
	};
}
