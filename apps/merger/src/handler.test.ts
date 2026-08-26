import { assertEquals } from "@std/assert";
import { handleMergeRequest, type MergerContext, revalidateBeforeMerge } from "./handler.ts";
import { createEnvTokenOidcVerifier } from "./oidc.ts";
import { type DecisionEnvelope, importHmacEnvelopeKey, signEnvelope } from "@yoroi/evidence";
import type {
	CheckRun,
	CheckRunInput,
	CheckRunUpdate,
	GitHubAdapter,
	MergeInput,
	MergeResult,
	PullRequestInfo,
	RepoRef,
} from "@yoroi/github";
import { pullRequestNumber as toPullRequestNumber } from "@yoroi/domain";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const DIGEST = "c".repeat(64);
const SHARED_TOKEN = "shared-secret";
const ENVELOPE_KEY = await importHmacEnvelopeKey(SHARED_TOKEN);

function envelope(overrides: Partial<DecisionEnvelope> = {}): DecisionEnvelope {
	return {
		operationId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
		installationId: 1,
		repositoryId: 2,
		owner: "acme",
		repoName: "widgets",
		pullRequestNumber: 42,
		headSha: SHA_A,
		baseSha: SHA_B,
		baseRef: "main",
		dependencyShas: [],
		candidateSha: SHA_A,
		scopeReviewProofs: {},
		policyDigest: DIGEST,
		approvalDigest: DIGEST,
		checkPlanDigest: DIGEST,
		evidenceDigest: DIGEST,
		fencingToken: "5",
		denoRevisionId: "rev-1",
		expiresAt: new Date(Date.now() + 60_000).toISOString(),
		...overrides,
	};
}

class FakeGitHubAdapter implements GitHubAdapter {
	prInfo: PullRequestInfo;
	mergeResult: MergeResult = { merged: true, mergeCommitSha: SHA_A as never, message: "merged" };
	mergeCalls: MergeInput[] = [];

	constructor(prInfo: PullRequestInfo) {
		this.prInfo = prInfo;
	}

	getPullRequest(_repo: RepoRef, _pr: unknown): Promise<PullRequestInfo> {
		return Promise.resolve(this.prInfo);
	}
	mergePullRequest(input: MergeInput): Promise<MergeResult> {
		this.mergeCalls.push(input);
		return Promise.resolve(this.mergeResult);
	}
	getTreeRecursive(): never {
		throw new Error("not used by handleMergeRequest");
	}
	getBlob(): never {
		throw new Error("not used by handleMergeRequest");
	}
	compareCommits(): never {
		throw new Error("not used by handleMergeRequest");
	}
	listPullRequestFiles(): never {
		throw new Error("not used by handleMergeRequest");
	}
	createCheckRun(_repo: RepoRef, _input: CheckRunInput): Promise<CheckRun> {
		throw new Error("not used by handleMergeRequest");
	}
	updateCheckRun(_repo: RepoRef, _id: number, _input: CheckRunUpdate): Promise<CheckRun> {
		throw new Error("not used by handleMergeRequest");
	}
	createComment(): never {
		throw new Error("not used by handleMergeRequest");
	}
	updateComment(): never {
		throw new Error("not used by handleMergeRequest");
	}
	mintInstallationToken(): never {
		throw new Error("not used by handleMergeRequest");
	}
	getRateLimitStatus(): never {
		throw new Error("not used by handleMergeRequest");
	}
}

function freshPrInfo(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
	return {
		number: toPullRequestNumber(42),
		headSha: SHA_A as never,
		baseSha: SHA_B as never,
		baseRef: "main",
		isDraft: false,
		mergeable: true,
		authorStableId: "U_author",
		title: "test PR",
		...overrides,
	};
}

interface FakeContextOptions {
	readonly prInfo?: PullRequestInfo;
	/** omit for the default (5n); pass explicitly (including `null`) to
	 * override — `??` would treat an explicit `null` the same as "omitted"
	 * and silently fall back to the default, so presence is checked via `in`
	 * instead. */
	readonly currentFencingToken?: bigint | null;
	readonly mergeResult?: MergeResult;
}

function fakeContext(opts: FakeContextOptions = {}): {
	ctx: MergerContext;
	github: FakeGitHubAdapter;
	appendedEvents: unknown[];
} {
	const github = new FakeGitHubAdapter(opts.prInfo ?? freshPrInfo());
	if (opts.mergeResult) github.mergeResult = opts.mergeResult;
	const appendedEvents: unknown[] = [];
	const fencingToken = "currentFencingToken" in opts ? opts.currentFencingToken! : 5n;

	const ctx: MergerContext = {
		github,
		oidcVerifier: createEnvTokenOidcVerifier(SHARED_TOKEN),
		envelopeVerifyKey: ENVELOPE_KEY,
		getCurrentFencingToken: () => Promise.resolve(fencingToken),
		appendDecisionEvent: (input) => {
			appendedEvents.push(input);
			return Promise.resolve({ seq: appendedEvents.length, rowHash: "hash" });
		},
	};
	return { ctx, github, appendedEvents };
}

async function buildRequest(
	env: DecisionEnvelope,
	key: CryptoKey,
	oidcToken: string | null,
): Promise<Request> {
	const signature = await signEnvelope(env, key);
	const headers = new Headers({ "content-type": "application/json" });
	if (oidcToken !== null) headers.set("x-deno-oidc-token", oidcToken);
	return new Request("http://localhost/internal/merge", {
		method: "POST",
		headers,
		body: JSON.stringify({ envelope: env, signature }),
	});
}

// --- revalidateBeforeMerge (pure) --------------------------------------

Deno.test("revalidateBeforeMerge: 全て一致すればok", () => {
	const env = envelope();
	const result = revalidateBeforeMerge(env, {
		headSha: env.headSha,
		baseSha: env.baseSha,
		isDraft: false,
		mergeable: true,
	});
	assertEquals(result.ok, true);
});

Deno.test("revalidateBeforeMerge: headが動いていればHEAD_SHA_MISMATCH", () => {
	const env = envelope();
	const result = revalidateBeforeMerge(env, {
		headSha: "f".repeat(40),
		baseSha: env.baseSha,
		isDraft: false,
		mergeable: true,
	});
	assertEquals(result.ok, false);
	if (result.ok) return;
	assertEquals(result.error.kind, "HEAD_SHA_MISMATCH");
});

Deno.test("revalidateBeforeMerge: Draftへ変わっていればPR_IS_DRAFT", () => {
	const env = envelope();
	const result = revalidateBeforeMerge(env, {
		headSha: env.headSha,
		baseSha: env.baseSha,
		isDraft: true,
		mergeable: true,
	});
	assertEquals(result.ok, false);
	if (result.ok) return;
	assertEquals(result.error.kind, "PR_IS_DRAFT");
});

// --- handleMergeRequest --------------------------------------------------

Deno.test("handleMergeRequest: OIDCトークンがなければ401", async () => {
	const { ctx } = fakeContext();
	const req = await buildRequest(envelope(), ctx.envelopeVerifyKey, null);
	const res = await handleMergeRequest(req, ctx);
	assertEquals(res.status, 401);
});

Deno.test("handleMergeRequest: 署名が不正なら401（GitHubへは一切到達しない）", async () => {
	const { ctx, github } = fakeContext();
	const env = envelope();
	const req = new Request("http://localhost/internal/merge", {
		method: "POST",
		headers: { "content-type": "application/json", "x-deno-oidc-token": SHARED_TOKEN },
		body: JSON.stringify({ envelope: env, signature: "not-a-real-signature" }),
	});
	const res = await handleMergeRequest(req, ctx);
	assertEquals(res.status, 401);
	assertEquals(github.mergeCalls.length, 0);
});

Deno.test("handleMergeRequest: 期限切れenvelopeは409", async () => {
	const { ctx } = fakeContext();
	const env = envelope({ expiresAt: new Date(Date.now() - 1).toISOString() });
	const req = await buildRequest(env, ctx.envelopeVerifyKey, SHARED_TOKEN);
	const res = await handleMergeRequest(req, ctx);
	assertEquals(res.status, 409);
	const body = await res.json();
	assertEquals(body.code, "ENVELOPE_EXPIRED");
});

Deno.test("handleMergeRequest: stale fencing token (AT-34) は409で拒否され、マージAPIは一切呼ばれない", async () => {
	const { ctx, github, appendedEvents } = fakeContext({ currentFencingToken: 99n }); // envelope has "5"
	const env = envelope({ fencingToken: "5" });
	const req = await buildRequest(env, ctx.envelopeVerifyKey, SHARED_TOKEN);
	const res = await handleMergeRequest(req, ctx);
	assertEquals(res.status, 409);
	const body = await res.json();
	assertEquals(body.code, "STALE_FENCING_TOKEN");
	assertEquals(github.mergeCalls.length, 0); // 二重merge防止の核心
	assertEquals(appendedEvents.length, 0); // fencing不一致はGitHub再取得の手前で弾かれる
});

Deno.test("handleMergeRequest: fencing tokenが存在しない(null)場合も409で拒否される", async () => {
	const { ctx, github } = fakeContext({ currentFencingToken: null });
	const req = await buildRequest(envelope(), ctx.envelopeVerifyKey, SHARED_TOKEN);
	const res = await handleMergeRequest(req, ctx);
	assertEquals(res.status, 409);
	assertEquals(github.mergeCalls.length, 0);
});

Deno.test("handleMergeRequest: 再取得したheadがenvelopeと違えば409、CANDIDATE_BUILDINGへ記録される", async () => {
	const { ctx, github, appendedEvents } = fakeContext({
		prInfo: freshPrInfo({ headSha: "f".repeat(40) as never }),
	});
	const req = await buildRequest(envelope(), ctx.envelopeVerifyKey, SHARED_TOKEN);
	const res = await handleMergeRequest(req, ctx);
	assertEquals(res.status, 409);
	assertEquals(github.mergeCalls.length, 0);
	assertEquals(appendedEvents.length, 1);
	assertEquals((appendedEvents[0] as { toState: string }).toState, "CANDIDATE_BUILDING");
});

Deno.test("handleMergeRequest: 全チェックを通過すればmergeを実行し200、MERGEDを記録する", async () => {
	const { ctx, github, appendedEvents } = fakeContext();
	const req = await buildRequest(envelope(), ctx.envelopeVerifyKey, SHARED_TOKEN);
	const res = await handleMergeRequest(req, ctx);
	assertEquals(res.status, 200);
	assertEquals(github.mergeCalls.length, 1);
	assertEquals(github.mergeCalls[0]?.idempotencyOperationId, "01ARZ3NDEKTSV4RRFFQ69G5FAV");
	assertEquals(appendedEvents.length, 1);
	assertEquals((appendedEvents[0] as { toState: string }).toState, "MERGED");
});

Deno.test("handleMergeRequest: GitHubがmerged:falseを返せば409、CANDIDATE_BUILDINGへ記録される", async () => {
	const { ctx, appendedEvents } = fakeContext({
		mergeResult: { merged: false, mergeCommitSha: null, message: "conflict" },
	});
	const req = await buildRequest(envelope(), ctx.envelopeVerifyKey, SHARED_TOKEN);
	const res = await handleMergeRequest(req, ctx);
	assertEquals(res.status, 409);
	assertEquals((appendedEvents[0] as { toState: string }).toState, "CANDIDATE_BUILDING");
});
