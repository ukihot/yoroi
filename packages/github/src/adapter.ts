import type {
	InstallationId,
	OperationId,
	PullRequestNumber,
	RepositoryId,
	Sha
} from '@yoroi/domain';

/**
 * design.md §13.1's `GitHubAdapter`, adapted: methods take a `RepoRef`
 * (owner/name + numeric id) rather than a bare `RepositoryId`, since REST
 * calls need `{owner, repo}` and design.md doesn't specify how that mapping
 * happens — `packages/postgres`'s `repository` table already stores
 * `owner/name`, so callers build `RepoRef` from that row. A few methods
 * design.md's §13.1 list doesn't include (createComment/updateComment for
 * §14.1, getPullRequest/getBlob for context-proof and merge revalidation)
 * are added, each noted below.
 */

export interface RepoRef {
	readonly installationId: InstallationId;
	readonly repositoryId: RepositoryId;
	readonly owner: string;
	readonly name: string;
}

export interface TreeEntryResponse {
	readonly path: string;
	readonly mode: string;
	readonly type: 'blob' | 'tree' | 'commit';
	readonly sha: Sha;
}

export interface TreeResponse {
	readonly sha: Sha;
	readonly truncated: boolean;
	readonly entries: readonly TreeEntryResponse[];
}

export interface CompareResponse {
	readonly files: readonly { readonly filename: string; readonly status: string }[];
}

export interface FileEntry {
	readonly filename: string;
	readonly status: string;
	readonly sha: Sha;
}

export interface CheckRunInput {
	readonly name: string;
	readonly headSha: Sha;
	readonly externalId: string;
	readonly status: 'queued' | 'in_progress' | 'completed';
	readonly conclusion?:
		'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required';
	readonly title: string;
	readonly summary: string;
	readonly text?: string;
}

export interface CheckRunUpdate {
	readonly status: 'queued' | 'in_progress' | 'completed';
	readonly conclusion?:
		'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required';
	readonly title: string;
	readonly summary: string;
	readonly text?: string;
}

export interface CheckRun {
	readonly id: number;
}

export interface MergeInput {
	readonly repo: RepoRef;
	readonly pullRequestNumber: PullRequestNumber;
	readonly candidateSha: Sha;
	readonly idempotencyOperationId: OperationId;
	readonly commitTitle?: string;
	readonly commitMessage?: string;
}

export interface MergeResult {
	readonly merged: boolean;
	readonly mergeCommitSha: Sha | null;
	readonly message: string;
}

export interface Permissions {
	readonly [permission: string]: 'read' | 'write' | 'admin';
}

export interface InstallationToken {
	readonly token: string;
	readonly expiresAt: Date;
}

export interface PullRequestInfo {
	readonly number: PullRequestNumber;
	readonly headSha: Sha;
	readonly baseSha: Sha;
	readonly baseRef: string;
	readonly isDraft: boolean;
	readonly mergeable: boolean | null;
	readonly authorStableId: string;
	readonly title: string;
}

export interface RateLimitStatus {
	readonly remaining: number;
	readonly limit: number;
	readonly remainingPct: number;
	readonly resetAt: Date;
}

export interface GitHubAdapter {
	getTreeRecursive(repo: RepoRef, sha: Sha): Promise<TreeResponse>;
	getBlob(repo: RepoRef, oid: Sha): Promise<Uint8Array>;
	compareCommits(repo: RepoRef, base: Sha, head: Sha): Promise<CompareResponse>;
	listPullRequestFiles(repo: RepoRef, pr: PullRequestNumber): Promise<FileEntry[]>;
	getPullRequest(repo: RepoRef, pr: PullRequestNumber): Promise<PullRequestInfo>;
	createCheckRun(repo: RepoRef, input: CheckRunInput): Promise<CheckRun>;
	updateCheckRun(repo: RepoRef, checkRunId: number, input: CheckRunUpdate): Promise<CheckRun>;
	/** §14.1 upsertSummary — not in §13.1's list but needed by it. */
	createComment(repo: RepoRef, pr: PullRequestNumber, markdown: string): Promise<{ id: number }>;
	updateComment(repo: RepoRef, commentId: number, markdown: string): Promise<void>;
	mergePullRequest(input: MergeInput): Promise<MergeResult>;
	mintInstallationToken(
		installationId: InstallationId,
		repositoryIds: readonly RepositoryId[],
		permissions: Permissions
	): Promise<InstallationToken>;
	getRateLimitStatus(): Promise<RateLimitStatus>;
}
