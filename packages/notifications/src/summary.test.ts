import { assertEquals } from '@std/assert';
import { type NotificationAnchorState, upsertSummary } from './summary.ts';
import type { SummaryState } from './render.ts';
import type {
	CheckRun,
	CheckRunInput,
	CheckRunUpdate,
	GitHubAdapter,
	RepoRef
} from '@yoroi/github';
import { installationId, pullRequestNumber, repositoryId, sha } from '@yoroi/domain';
import type { ReasonGraphNode } from '@yoroi/policy';

class FakeGitHubAdapter implements GitHubAdapter {
	createdComments: { markdown: string }[] = [];
	updatedComments: { commentId: number; markdown: string }[] = [];
	createdCheckRuns: CheckRunInput[] = [];
	updatedCheckRuns: { checkRunId: number; input: CheckRunUpdate }[] = [];
	private nextCommentId = 1;
	private nextCheckRunId = 1;

	createComment(_repo: RepoRef, _pr: unknown, markdown: string): Promise<{ id: number }> {
		this.createdComments.push({ markdown });
		return Promise.resolve({ id: this.nextCommentId++ });
	}
	updateComment(_repo: RepoRef, commentId: number, markdown: string): Promise<void> {
		this.updatedComments.push({ commentId, markdown });
		return Promise.resolve();
	}
	createCheckRun(_repo: RepoRef, input: CheckRunInput): Promise<CheckRun> {
		this.createdCheckRuns.push(input);
		return Promise.resolve({ id: this.nextCheckRunId++ });
	}
	updateCheckRun(_repo: RepoRef, checkRunId: number, input: CheckRunUpdate): Promise<CheckRun> {
		this.updatedCheckRuns.push({ checkRunId, input });
		return Promise.resolve({ id: checkRunId });
	}
	getTreeRecursive(): never {
		throw new Error('not used by upsertSummary');
	}
	getBlob(): never {
		throw new Error('not used by upsertSummary');
	}
	compareCommits(): never {
		throw new Error('not used by upsertSummary');
	}
	listPullRequestFiles(): never {
		throw new Error('not used by upsertSummary');
	}
	getPullRequest(): never {
		throw new Error('not used by upsertSummary');
	}
	mergePullRequest(): never {
		throw new Error('not used by upsertSummary');
	}
	mintInstallationToken(): never {
		throw new Error('not used by upsertSummary');
	}
	getRateLimitStatus(): never {
		throw new Error('not used by upsertSummary');
	}
}

const repo: RepoRef = {
	installationId: installationId(1),
	repositoryId: repositoryId(2),
	owner: 'org',
	name: 'repo'
};
const pr = pullRequestNumber(42);
const headSha = sha('a'.repeat(40));
const graph: ReasonGraphNode = { label: 'Merge可能', children: [] };
const state: SummaryState = {
	stage: 'review',
	reasonHeadline: 'レビュー待ち',
	nextActor: 'reviewer',
	etaRange: null,
	confidence: null
};
const emptyAnchor: NotificationAnchorState = {
	summaryCommentId: null,
	checkRunId: null,
	lastReasonHash: null
};

Deno.test('upsertSummary: anchorが空なら新規commentとcheck runを作る', async () => {
	const gh = new FakeGitHubAdapter();
	const result = await upsertSummary(gh, repo, pr, headSha, emptyAnchor, state, graph);
	assertEquals(gh.createdComments.length, 1);
	assertEquals(gh.createdCheckRuns.length, 1);
	assertEquals(result.skippedComment, false);
	assertEquals(result.summaryCommentId, 1);
	assertEquals(result.checkRunId, 1);
});

Deno.test('upsertSummary: 内容が変わらなければcommentの書き込みをskipする (NFR-021)', async () => {
	const gh = new FakeGitHubAdapter();
	const first = await upsertSummary(gh, repo, pr, headSha, emptyAnchor, state, graph);
	const anchorAfterFirst: NotificationAnchorState = {
		summaryCommentId: first.summaryCommentId,
		checkRunId: first.checkRunId,
		lastReasonHash: first.reasonHash
	};

	const second = await upsertSummary(gh, repo, pr, headSha, anchorAfterFirst, state, graph);
	assertEquals(second.skippedComment, true);
	assertEquals(gh.createdComments.length, 1); // まだ1件のまま(2回目は書き込まれていない)
	assertEquals(gh.updatedComments.length, 0);
});

Deno.test('upsertSummary: 内容が変われば既存commentをupdateする（新規作成しない）', async () => {
	const gh = new FakeGitHubAdapter();
	const first = await upsertSummary(gh, repo, pr, headSha, emptyAnchor, state, graph);
	const anchorAfterFirst: NotificationAnchorState = {
		summaryCommentId: first.summaryCommentId,
		checkRunId: first.checkRunId,
		lastReasonHash: first.reasonHash
	};

	const changedState: SummaryState = { ...state, reasonHeadline: '承認されました' };
	const second = await upsertSummary(gh, repo, pr, headSha, anchorAfterFirst, changedState, graph);
	assertEquals(second.skippedComment, false);
	assertEquals(gh.createdComments.length, 1);
	assertEquals(gh.updatedComments.length, 1);
	assertEquals(gh.updatedComments[0]?.commentId, first.summaryCommentId);
});

Deno.test('upsertSummary: check runは内容が変わらなくても毎回updateされる', async () => {
	const gh = new FakeGitHubAdapter();
	const first = await upsertSummary(gh, repo, pr, headSha, emptyAnchor, state, graph);
	const anchorAfterFirst: NotificationAnchorState = {
		summaryCommentId: first.summaryCommentId,
		checkRunId: first.checkRunId,
		lastReasonHash: first.reasonHash
	};
	await upsertSummary(gh, repo, pr, headSha, anchorAfterFirst, state, graph);
	assertEquals(gh.createdCheckRuns.length, 1);
	assertEquals(gh.updatedCheckRuns.length, 1);
});
