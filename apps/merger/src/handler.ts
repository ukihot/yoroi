import type { AppendDecisionEventInput, BranchCoordinatorKey } from "@yoroi/postgres";
import type { GitHubAdapter, RepoRef } from "@yoroi/github";
import {
	type DecisionEnvelope,
	DecisionEnvelopeSchema,
	isExpired,
	verifyEnvelopeSignature,
} from "@yoroi/evidence";
import {
	installationId as toInstallationId,
	operationId as toOperationId,
	pullRequestNumber as toPullRequestNumber,
	repositoryId as toRepositoryId,
	sha as toSha,
} from "@yoroi/domain";
import type { OidcVerifier } from "@yoroi/domain";
import { withSpan } from "@yoroi/observability";
import { oidcErrorToHttpBody } from "./oidc.ts";

/**
 * `getCurrentFencingToken`/`appendDecisionEvent` are injected as plain
 * functions (design.md §1.5 Ports at the Edges) rather than this file
 * importing `@yoroi/postgres` and calling them against a raw `Db` directly —
 * this is the single most safety-critical handler in the whole system
 * (AT-34's stale-fencing-token rejection lives here), so it's worth being
 * fully unit-testable with lightweight fakes instead of needing a live
 * Postgres connection to exercise every rejection branch. `main.ts` wires
 * the real `@yoroi/postgres` functions bound to a real `Db`.
 */
export interface MergerContext {
	readonly github: GitHubAdapter;
	readonly oidcVerifier: OidcVerifier;
	readonly envelopeVerifyKey: CryptoKey;
	getCurrentFencingToken(key: BranchCoordinatorKey): Promise<bigint | null>;
	appendDecisionEvent(
		input: AppendDecisionEventInput,
	): Promise<{ readonly seq: number; readonly rowHash: string }>;
}

interface ApiError {
	readonly code: string;
	readonly humanReason: string;
}

function errorResponse(status: number, error: ApiError): Response {
	return Response.json(error, { status });
}

export type RevalidationError =
	| { readonly kind: "HEAD_SHA_MISMATCH"; readonly expected: string; readonly actual: string }
	| { readonly kind: "BASE_SHA_MISMATCH"; readonly expected: string; readonly actual: string }
	| { readonly kind: "PR_IS_DRAFT" }
	| { readonly kind: "PR_NOT_MERGEABLE" };

export interface AuthoritativePrState {
	readonly headSha: string;
	readonly baseSha: string;
	readonly isDraft: boolean;
	readonly mergeable: boolean | null;
}

/**
 * design.md §12.3 step 4/§8.4 "MERGING直前": re-fetched GitHub state must
 * still match what the envelope was built from. A mismatch sends the state
 * machine back to CANDIDATE_BUILDING conceptually — concretely here, it's a
 * 409 that tells `apps/control` to rebuild and resubmit, never a merge.
 */
export function revalidateBeforeMerge(
	envelope: DecisionEnvelope,
	fresh: AuthoritativePrState,
): { readonly ok: true } | { readonly ok: false; readonly error: RevalidationError } {
	if (fresh.headSha !== envelope.headSha) {
		return {
			ok: false,
			error: { kind: "HEAD_SHA_MISMATCH", expected: envelope.headSha, actual: fresh.headSha },
		};
	}
	if (fresh.baseSha !== envelope.baseSha) {
		return {
			ok: false,
			error: { kind: "BASE_SHA_MISMATCH", expected: envelope.baseSha, actual: fresh.baseSha },
		};
	}
	if (fresh.isDraft) return { ok: false, error: { kind: "PR_IS_DRAFT" } };
	if (fresh.mergeable === false) return { ok: false, error: { kind: "PR_NOT_MERGEABLE" } };
	return { ok: true };
}

function revalidationErrorBody(error: RevalidationError): ApiError {
	switch (error.kind) {
		case "HEAD_SHA_MISMATCH":
			return {
				code: "HEAD_SHA_MISMATCH",
				humanReason: "PR head moved since the envelope was built",
			};
		case "BASE_SHA_MISMATCH":
			return {
				code: "BASE_SHA_MISMATCH",
				humanReason: "base branch advanced since the envelope was built",
			};
		case "PR_IS_DRAFT":
			return {
				code: "PR_IS_DRAFT",
				humanReason: "PR was converted to Draft since the envelope was built",
			};
		case "PR_NOT_MERGEABLE":
			return {
				code: "PR_NOT_MERGEABLE",
				humanReason: "GitHub reports this PR is not currently mergeable",
			};
	}
}

/**
 * design.md §12.3's 5-step sequence: OIDC verify → envelope schema+signature
 * +expiry verify → fencing token equality (AT-34) → authoritative GitHub
 * re-fetch + revalidation → merge execution + hash-chained decision_event.
 * Every rejection path returns before any GitHub write — fail-closed
 * throughout (SEC-018, DP-03).
 */
export function handleMergeRequest(req: Request, ctx: MergerContext): Promise<Response> {
	return withSpan("merge_request", {}, async () => {
		// 1. OIDC verify
		const idToken = req.headers.get("x-deno-oidc-token");
		const verified = await ctx.oidcVerifier.verify(idToken, {
			audience: "yoroi-merger",
			allowedCallerApp: "yoroi-control",
			requiredContext: "production",
		});
		if (!verified.ok) return errorResponse(401, oidcErrorToHttpBody(verified.error));

		// 2. envelope schema + signature + expiry
		let body: { envelope?: unknown; signature?: unknown };
		try {
			body = await req.json();
		} catch {
			return errorResponse(400, { code: "BAD_REQUEST", humanReason: "request body must be JSON" });
		}

		const parsedEnvelope = DecisionEnvelopeSchema.safeParse(body.envelope);
		if (!parsedEnvelope.success) {
			return errorResponse(400, {
				code: "BAD_ENVELOPE",
				humanReason: "envelope failed schema validation",
			});
		}
		const envelope = parsedEnvelope.data;

		if (typeof body.signature !== "string") {
			return errorResponse(401, {
				code: "BAD_SIGNATURE",
				humanReason: "signature missing or not a string",
			});
		}
		const signatureValid = await verifyEnvelopeSignature(
			envelope,
			body.signature,
			ctx.envelopeVerifyKey,
		);
		if (!signatureValid) {
			return errorResponse(401, {
				code: "BAD_SIGNATURE",
				humanReason: "envelope signature does not verify",
			});
		}
		if (isExpired(envelope)) {
			return errorResponse(409, {
				code: "ENVELOPE_EXPIRED",
				humanReason: "decision envelope has expired",
			});
		}

		// 3. fencing token check (AT-34) — string-exact match, no numeric coercion
		const currentFencingToken = await ctx.getCurrentFencingToken({
			installationId: envelope.installationId,
			repositoryId: envelope.repositoryId,
			targetBranch: envelope.baseRef,
		});
		if (currentFencingToken === null || currentFencingToken.toString() !== envelope.fencingToken) {
			return errorResponse(409, {
				code: "STALE_FENCING_TOKEN",
				humanReason: "this operation no longer holds the branch lease",
			});
		}

		// 4. authoritative re-fetch just before merge
		const repo: RepoRef = {
			installationId: toInstallationId(envelope.installationId),
			repositoryId: toRepositoryId(envelope.repositoryId),
			owner: envelope.owner,
			name: envelope.repoName,
		};
		const prNumber = toPullRequestNumber(envelope.pullRequestNumber);
		const fresh = await ctx.github.getPullRequest(repo, prNumber);
		const revalidation = revalidateBeforeMerge(envelope, fresh);
		if (!revalidation.ok) {
			await ctx.appendDecisionEvent({
				operationId: envelope.operationId,
				repoId: `${envelope.owner}/${envelope.repoName}`,
				prNumber: envelope.pullRequestNumber,
				actorStableId: null,
				operation: "merge",
				fromState: "GATE_PASSED",
				toState: "CANDIDATE_BUILDING",
				reasonCode: revalidation.error.kind.toLowerCase(),
				result: "failure",
				evidence: { revalidation: revalidation.error },
			});
			return errorResponse(409, revalidationErrorBody(revalidation.error));
		}

		// 5. merge execution (FR-061: operationId is the idempotency key)
		const mergeResult = await ctx.github.mergePullRequest({
			repo,
			pullRequestNumber: prNumber,
			candidateSha: toSha(envelope.candidateSha),
			idempotencyOperationId: toOperationId(envelope.operationId),
		});

		await ctx.appendDecisionEvent({
			operationId: envelope.operationId,
			repoId: `${envelope.owner}/${envelope.repoName}`,
			prNumber: envelope.pullRequestNumber,
			actorStableId: null,
			operation: "merge",
			fromState: "GATE_PASSED",
			toState: mergeResult.merged ? "MERGED" : "CANDIDATE_BUILDING",
			reasonCode: mergeResult.merged ? "gate_passed" : "github_merge_rejected",
			result: mergeResult.merged ? "success" : "failure",
			evidence: { mergeResult },
		});

		return Response.json(mergeResult, { status: mergeResult.merged ? 200 : 409 });
	});
}
