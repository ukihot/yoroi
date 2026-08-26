import type { ActorStableId, PullRequestNumber, Sha } from "@yoroi/domain";
import type { RepoRef } from "@yoroi/github";
import type { ReasonGraphNode } from "@yoroi/policy";
import type { EtaConfidence } from "../render.ts";

/**
 * design.md §9.9.1's slash command registry, §15.1–15.2. `RepoPermission` is
 * a 3-level GitHub repo permission rank; design.md's registry table also
 * lists "PR author" as an alternative qualifier for `/yoroi recheck`
 * specifically ("repo write以上またはPR author") — modeled here as
 * `allowPrAuthor` on the spec rather than a 4th permission rank, since it's
 * an OR-condition against `isPrAuthor`, not a point on the read<write<
 * operator ladder.
 */
export type RepoPermission = "read" | "write" | "operator";

export const PERMISSION_RANK: Readonly<Record<RepoPermission, number>> = {
	read: 0,
	write: 1,
	operator: 2,
};

export interface CommandContext {
	readonly repo: RepoRef;
	readonly pullRequestNumber: PullRequestNumber;
	readonly actorStableId: ActorStableId;
	readonly repoPermission: RepoPermission;
	readonly isPrAuthor: boolean;
	readonly observedHeadSha: Sha;
}

export type CommandResult =
	| { readonly kind: "ok"; readonly markdown: string }
	| { readonly kind: "pending"; readonly markdown: string }
	| { readonly kind: "denied"; readonly reason: string }
	| { readonly kind: "rate_limited"; readonly retryAfterSeconds: number }
	| { readonly kind: "unknown_command"; readonly attempted: string };

export interface GateSnapshot {
	readonly headSha: Sha;
	readonly gateConclusion: "PASS" | "BLOCKED" | "PENDING";
	readonly reasonGraph: ReasonGraphNode;
}

export interface QueueSnapshot {
	readonly position: number | null;
	readonly lane: string;
	readonly etaFrom: Date | null;
	readonly etaTo: Date | null;
	readonly etaConfidence: EtaConfidence | null;
}

export interface AuditEventInput {
	readonly kind: string;
	readonly actorStableId: ActorStableId;
	readonly before: unknown;
	readonly after: unknown;
}

export type FlakyConfidence = "known_infra" | "known_flaky" | "possible_change_related";

export interface FlakyReportInput {
	readonly repo: RepoRef;
	readonly testId: string;
	readonly runUrl: string;
	readonly actorStableId: ActorStableId;
}

export interface FlakyReportResult {
	readonly confidence: FlakyConfidence;
	readonly failureFingerprint: string;
}

export interface FlakyQuarantineProposalInput {
	readonly repo: RepoRef;
	readonly testId: string;
	readonly owner: string;
	readonly reason: string;
	readonly expiresAt: Date;
	readonly actorStableId: ActorStableId;
}

export interface FeedbackInput {
	readonly repo: RepoRef;
	readonly pullRequestNumber: PullRequestNumber | null;
	readonly category: string;
	readonly actorStableId: ActorStableId;
	readonly description: string;
}

/**
 * design.md §1.5 Ports at the Edges: every I/O a handler needs (DB reads/
 * writes, GitHub re-fetch, re-evaluation) is injected here rather than
 * imported directly, so handlers stay unit-testable with fakes and this
 * package never depends on packages/postgres.
 */
export interface CommandPorts {
	getGateSnapshot(repo: RepoRef, pr: PullRequestNumber): Promise<GateSnapshot | null>;
	getQueueSnapshot(repo: RepoRef, pr: PullRequestNumber): Promise<QueueSnapshot | null>;
	refetchAuthoritativeHeadSha(repo: RepoRef, pr: PullRequestNumber): Promise<Sha>;
	reevaluate(repo: RepoRef, pr: PullRequestNumber): Promise<GateSnapshot>;
	/** `false` = already cooling down (a recent call already holds this key) —
	 * design.md §9.9.2's coalesce/rate-limit for recheck abuse (AT-30). */
	tryAcquireCooldown(key: string, cooldownSeconds: number): Promise<boolean>;
	recordAuditEvent(input: AuditEventInput): Promise<void>;
	recordFlakyReport(input: FlakyReportInput): Promise<FlakyReportResult>;
	createFlakyQuarantineProposal(
		input: FlakyQuarantineProposalInput,
	): Promise<{ readonly proposalId: string }>;
	recordFeedback(input: FeedbackInput): Promise<{ readonly id: number }>;
}

export type CommandHandler = (
	ctx: CommandContext,
	args: readonly string[],
	ports: CommandPorts,
) => Promise<CommandResult>;

export interface SlashCommandSpec {
	readonly name: string;
	readonly minPermission: RepoPermission;
	readonly allowPrAuthor: boolean;
	readonly sideEffecting: boolean;
	readonly idempotent: boolean;
	readonly rateLimitKey: (ctx: CommandContext) => string;
	readonly handler: CommandHandler;
}

export function isAuthorized(ctx: CommandContext, spec: SlashCommandSpec): boolean {
	if (PERMISSION_RANK[ctx.repoPermission] >= PERMISSION_RANK[spec.minPermission]) return true;
	return spec.allowPrAuthor && ctx.isPrAuthor;
}
