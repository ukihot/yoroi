import { Octokit } from 'octokit';
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';
import { createAppAuth } from '@octokit/auth-app';
import type { InstallationId, RepositoryId } from '@yoroi/domain';
import { sha } from '@yoroi/domain';
import type {
	CheckRun,
	CompareResponse,
	FileEntry,
	GitHubAdapter,
	InstallationToken,
	MergeInput,
	MergeResult,
	Permissions,
	PullRequestInfo,
	RateLimitStatus,
	RepoRef,
	TreeResponse
} from './adapter.ts';

/**
 * design.md §13.2/§13.3. Not runtime-verified against live GitHub in this
 * session (no App credentials yet — see plan notes); built against Octokit's
 * documented REST/auth-app surface as carefully as possible, to be smoke-
 * tested against the real App once credentials exist.
 */

const ThrottledOctokit = Octokit.plugin(throttling, retry);

interface CachedToken {
	readonly token: string;
	readonly expiresAt: Date;
}

const REFRESH_MARGIN_MS = 5 * 60_000; // mint a new token 5 minutes before GitHub's own expiry

function cacheKey(
	installationId: InstallationId,
	repositoryIds: readonly RepositoryId[],
	permissions: Permissions
): string {
	const repos = [...repositoryIds].sort((a, b) => a - b).join(',');
	const perms = Object.keys(permissions)
		.sort()
		.map((k) => `${k}=${permissions[k]}`)
		.join(',');
	return `${installationId}:${repos}:${perms}`;
}

export function createOctokitAdapter(appId: string, privateKey: string): GitHubAdapter {
	const appAuth = createAppAuth({ appId, privateKey });
	const tokenCache = new Map<string, CachedToken>();

	async function mintInstallationToken(
		installId: InstallationId,
		repositoryIds: readonly RepositoryId[],
		permissions: Permissions
	): Promise<InstallationToken> {
		const key = cacheKey(installId, repositoryIds, permissions);
		const cached = tokenCache.get(key);
		if (cached && cached.expiresAt.getTime() - REFRESH_MARGIN_MS > Date.now()) {
			return cached;
		}
		// SEC-002: token生成時にrepo/permissionをさらに限定する
		const auth = await appAuth({
			type: 'installation',
			installationId: installId,
			repositoryIds: [...repositoryIds],
			permissions
		});
		const token: CachedToken = { token: auth.token, expiresAt: new Date(auth.expiresAt) };
		tokenCache.set(key, token);
		return token;
	}

	async function clientFor(repo: RepoRef, permissions: Permissions): Promise<Octokit> {
		const token = await mintInstallationToken(
			repo.installationId,
			[repo.repositoryId],
			permissions
		);
		return new ThrottledOctokit({
			auth: token.token,
			throttle: {
				onRateLimit: (retryAfter: number, options: { method: string; url: string }) => {
					console.warn(
						`[yoroi-github] rate limited on ${options.method} ${options.url}, retrying after ${retryAfter}s`
					);
					return true;
				},
				onSecondaryRateLimit: () => true
			}
		});
	}

	return {
		async getTreeRecursive(repo, treeSha): Promise<TreeResponse> {
			const octokit = await clientFor(repo, { contents: 'read' });
			const res = await octokit.rest.git.getTree({
				owner: repo.owner,
				repo: repo.name,
				tree_sha: treeSha,
				recursive: '1'
			});
			return {
				sha: sha(res.data.sha),
				truncated: res.data.truncated ?? false,
				entries: (res.data.tree ?? [])
					.filter(
						(e): e is typeof e & { path: string; mode: string; type: string; sha: string } =>
							e.path !== undefined &&
							e.mode !== undefined &&
							e.type !== undefined &&
							e.sha !== undefined
					)
					.map((e) => ({
						path: e.path,
						mode: e.mode,
						type: e.type as 'blob' | 'tree' | 'commit',
						sha: sha(e.sha)
					}))
			};
		},

		async getBlob(repo, oid): Promise<Uint8Array> {
			const octokit = await clientFor(repo, { contents: 'read' });
			const res = await octokit.rest.git.getBlob({
				owner: repo.owner,
				repo: repo.name,
				file_sha: oid
			});
			if (res.data.encoding === 'base64') {
				return Uint8Array.from(atob(res.data.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
			}
			return new TextEncoder().encode(res.data.content);
		},

		async compareCommits(repo, base, head): Promise<CompareResponse> {
			const octokit = await clientFor(repo, { contents: 'read' });
			const res = await octokit.rest.repos.compareCommitsWithBasehead({
				owner: repo.owner,
				repo: repo.name,
				basehead: `${base}...${head}`
			});
			return {
				files: (res.data.files ?? []).map((f) => ({ filename: f.filename, status: f.status }))
			};
		},

		async listPullRequestFiles(repo, pr): Promise<FileEntry[]> {
			const octokit = await clientFor(repo, { pull_requests: 'read' });
			const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
				owner: repo.owner,
				repo: repo.name,
				pull_number: pr
			});
			return files.map((f) => ({ filename: f.filename, status: f.status, sha: sha(f.sha) }));
		},

		async getPullRequest(repo, pr): Promise<PullRequestInfo> {
			const octokit = await clientFor(repo, { pull_requests: 'read' });
			const res = await octokit.rest.pulls.get({
				owner: repo.owner,
				repo: repo.name,
				pull_number: pr
			});
			return {
				number: pr,
				headSha: sha(res.data.head.sha),
				baseSha: sha(res.data.base.sha),
				baseRef: res.data.base.ref,
				isDraft: res.data.draft ?? false,
				mergeable: res.data.mergeable,
				authorStableId: res.data.user?.node_id ?? '',
				title: res.data.title
			};
		},

		async createCheckRun(repo, input): Promise<CheckRun> {
			const octokit = await clientFor(repo, { checks: 'write' });
			const res = await octokit.rest.checks.create({
				owner: repo.owner,
				repo: repo.name,
				name: input.name,
				head_sha: input.headSha,
				external_id: input.externalId,
				status: input.status,
				conclusion: input.conclusion,
				output: { title: input.title, summary: input.summary, text: input.text }
			});
			return { id: res.data.id };
		},

		async updateCheckRun(repo, checkRunId, input): Promise<CheckRun> {
			const octokit = await clientFor(repo, { checks: 'write' });
			const res = await octokit.rest.checks.update({
				owner: repo.owner,
				repo: repo.name,
				check_run_id: checkRunId,
				status: input.status,
				conclusion: input.conclusion,
				output: { title: input.title, summary: input.summary, text: input.text }
			});
			return { id: res.data.id };
		},

		async createComment(repo, pr, markdown): Promise<{ id: number }> {
			const octokit = await clientFor(repo, { pull_requests: 'write' });
			const res = await octokit.rest.issues.createComment({
				owner: repo.owner,
				repo: repo.name,
				issue_number: pr,
				body: markdown
			});
			return { id: res.data.id };
		},

		async updateComment(repo, commentId, markdown): Promise<void> {
			const octokit = await clientFor(repo, { pull_requests: 'write' });
			await octokit.rest.issues.updateComment({
				owner: repo.owner,
				repo: repo.name,
				comment_id: commentId,
				body: markdown
			});
		},

		async mergePullRequest(input: MergeInput): Promise<MergeResult> {
			// FR-061 idempotency on operationId is enforced by the caller
			// (apps/merger checks decision_event for this operationId before
			// ever reaching here — GitHub's merge endpoint itself has no
			// idempotency-key concept to hook into at this layer).
			const octokit = await clientFor(input.repo, { contents: 'write', pull_requests: 'write' });
			const res = await octokit.rest.pulls.merge({
				owner: input.repo.owner,
				repo: input.repo.name,
				pull_number: input.pullRequestNumber,
				sha: input.candidateSha,
				commit_title: input.commitTitle,
				commit_message: input.commitMessage,
				merge_method: 'merge'
			});
			return {
				merged: res.data.merged,
				mergeCommitSha: res.data.sha ? sha(res.data.sha) : null,
				message: res.data.message
			};
		},

		mintInstallationToken,

		async getRateLimitStatus(): Promise<RateLimitStatus> {
			const octokit = new ThrottledOctokit({
				authStrategy: createAppAuth,
				auth: { appId, privateKey }
			});
			const res = await octokit.rest.rateLimit.get();
			const core = res.data.resources.core;
			return {
				remaining: core.remaining,
				limit: core.limit,
				remainingPct: core.limit > 0 ? Math.round((core.remaining / core.limit) * 100) : 100,
				resetAt: new Date(core.reset * 1000)
			};
		}
	};
}
