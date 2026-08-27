import type { CheckRunInput, GitHubAdapter, RepoRef } from '@yoroi/github';
import type { PullRequestNumber, Sha } from '@yoroi/domain';
import type { ReasonGraphNode } from '@yoroi/policy';
import { buildCheckRunOutput } from './check-run.ts';
import { renderSummaryMarkdown, type SummaryState } from './render.ts';

/** design.md §14.1's `notification_anchor` row, as plain data — this package
 * never touches Postgres itself (see deno.jsonc's top comment); the caller
 * reads/writes the row via packages/postgres. */
export interface NotificationAnchorState {
	readonly summaryCommentId: number | null;
	readonly checkRunId: number | null;
	readonly lastReasonHash: string | null;
}

export interface UpsertSummaryResult {
	readonly summaryCommentId: number;
	readonly checkRunId: number;
	readonly reasonHash: string;
	/** true when the PR comment write was skipped because rendered content
	 * hash matched `anchor.lastReasonHash` (NFR-021: no-op on unchanged
	 * content). The Check Run is kept current on every call regardless. */
	readonly skippedComment: boolean;
}

function toDigestInput(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		'SHA-256',
		toDigestInput(new TextEncoder().encode(text))
	);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * design.md §14.1. Single mutable summary (FR-070): the PR comment is only
 * re-written when its rendered content actually changed; the Check Run is
 * always kept in sync (created once, then updated every call) since it
 * doesn't generate the same notification noise a new/edited comment does.
 */
export async function upsertSummary(
	gh: GitHubAdapter,
	repo: RepoRef,
	pullRequestNumber: PullRequestNumber,
	headSha: Sha,
	anchor: NotificationAnchorState,
	state: SummaryState,
	reasonGraph: ReasonGraphNode
): Promise<UpsertSummaryResult> {
	const markdown = renderSummaryMarkdown(state, reasonGraph);
	const reasonHash = await sha256Hex(markdown);
	const skippedComment = reasonHash === anchor.lastReasonHash && anchor.summaryCommentId !== null;

	let summaryCommentId = anchor.summaryCommentId;
	if (!skippedComment) {
		if (summaryCommentId === null) {
			summaryCommentId = (await gh.createComment(repo, pullRequestNumber, markdown)).id;
		} else {
			await gh.updateComment(repo, summaryCommentId, markdown);
		}
	}

	const checkRunOutput = buildCheckRunOutput(state, reasonGraph);
	let checkRunId = anchor.checkRunId;
	if (checkRunId === null) {
		const input: CheckRunInput = {
			name: 'yoroi/gate',
			headSha,
			externalId: `${repo.repositoryId}:${pullRequestNumber}`,
			...checkRunOutput
		};
		checkRunId = (await gh.createCheckRun(repo, input)).id;
	} else {
		await gh.updateCheckRun(repo, checkRunId, checkRunOutput);
	}

	return {
		summaryCommentId: summaryCommentId!,
		checkRunId,
		reasonHash,
		skippedComment
	};
}
