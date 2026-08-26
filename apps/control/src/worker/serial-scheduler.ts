import { and, asc, desc, eq } from "drizzle-orm";
import type { OutboxWork } from "@yoroi/postgres";
import {
	acquireLease,
	appendDecisionEvent,
	approval as approvalTable,
	ensureBranchCoordinatorRow,
	mergeCandidate,
	prDecisionSnapshot,
	queueEntry,
	repository,
} from "@yoroi/postgres";
import type { RepoRef } from "@yoroi/github";
import {
	generateOperationId,
	installationId as toInstallationId,
	pullRequestNumber as toPullRequestNumber,
	repositoryId as toRepositoryId,
	sha256HexOf,
} from "@yoroi/domain";
import { compilePolicy } from "@yoroi/policy";
import {
	type DecisionEnvelope,
	DecisionEnvelopeSchema,
	importHmacEnvelopeKey,
	signEnvelope,
} from "@yoroi/evidence";
import { withSpan } from "@yoroi/observability";
import type { ControlContext } from "../context.ts";
import { parseEventFacts } from "./event-facts.ts";
import { DEFAULT_POLICY } from "./default-policy.ts";
import { mustGetEnv } from "../env.ts";

const ENVELOPE_TTL_MS = 5 * 60_000;

async function sha256HexOfString(text: string): Promise<string> {
	return await sha256HexOf(new TextEncoder().encode(text));
}

/**
 * design.md §11.1's `runSerialCycle`, simplified to a single per-invocation
 * step (this project has no long-running scheduler process — `apps/control`
 * runs on Deno Deploy request/Cron cycles, so "wait for gate or timeout" is
 * naturally spread across however many `evaluate_policy`/Cron-triggered
 * calls it takes, not one blocking loop): promote gate-passed PRs into the
 * queue → acquire the branch lease → build a one-PR candidate → if the gate
 * is still green, sign and submit a Decision Envelope to yoroi-merger.
 * Serial only ever combines base + exactly one PR (design.md §1.2/§20.1 —
 * Speculative/Batch stay unwired per this pass's scope).
 */
export function runSerialCycle(ctx: ControlContext, work: OutboxWork): Promise<void> {
	return withSpan(
		"serial_cycle",
		{ repositoryId: toRepositoryId(work.repositoryId ?? 0) },
		async () => {
			const facts = parseEventFacts(work.payload);
			if (!facts.repoFullName) return;
			const repoId = facts.repoFullName;

			const [repoRow] = await ctx.db.select().from(repository).where(eq(repository.repoId, repoId))
				.limit(
					1,
				);
			if (!repoRow || repoRow.mode !== "serial" || repoRow.status !== "active") return;

			await promotePassedPrsToQueue(ctx, repoId);

			const [next] = await ctx.db
				.select()
				.from(queueEntry)
				.where(eq(queueEntry.repoId, repoId))
				.orderBy(desc(queueEntry.priority), asc(queueEntry.enqueuedAt))
				.limit(1);
			if (!next) return;

			const [owner, name] = repoId.split("/");
			if (!owner || !name) return;
			const repo: RepoRef = {
				installationId: toInstallationId(repoRow.installationId),
				repositoryId: toRepositoryId(repoRow.githubRepositoryId ?? 0),
				owner,
				name,
			};
			const prNumber = toPullRequestNumber(next.prNumber);
			const prInfo = await ctx.github.getPullRequest(repo, prNumber);

			// design.md §10.1/AT-34: only one operation may hold the lease for this
			// repo+branch at a time; losing the race means no valid fencing token,
			// so this operation simply stops here rather than proceeding unsafely.
			const operationId = generateOperationId();
			await ensureBranchCoordinatorRow(ctx.db, {
				installationId: repoRow.installationId,
				repositoryId: repoRow.githubRepositoryId ?? 0,
				targetBranch: prInfo.baseRef,
			});
			const lease = await acquireLease(
				ctx.db,
				{
					installationId: repoRow.installationId,
					repositoryId: repoRow.githubRepositoryId ?? 0,
					targetBranch: prInfo.baseRef,
				},
				operationId,
				prInfo.baseSha,
			);
			if (!lease) return;

			// Serial mode: the candidate *is* the PR's own head merged onto base —
			// no synthetic multi-PR commit to build at this layer (GitHub's merge
			// API performs that merge; Speculative's cumulative-candidate synthesis,
			// design.md §11.2, is the dormant packages/domain/src/scheduler/lane.ts
			// building block, not wired here).
			await ctx.db
				.insert(mergeCandidate)
				.values({
					candidateSha: prInfo.headSha,
					installationId: repoRow.installationId,
					repositoryId: repoRow.githubRepositoryId ?? 0,
					pullRequestNumber: next.prNumber,
					baseSha: prInfo.baseSha,
					orderedHeads: [prInfo.headSha],
					policyDigest: "",
				})
				.onConflictDoNothing();

			const [snapshot] = await ctx.db
				.select()
				.from(prDecisionSnapshot)
				.where(
					and(
						eq(prDecisionSnapshot.repoId, repoId),
						eq(prDecisionSnapshot.prNumber, next.prNumber),
					),
				)
				.limit(1);
			if (!snapshot?.allGatesPassed) return; // まだ合格していない — 次のサイクルへ持ち越す

			// base advanced-since-lease staleness is intentionally NOT checked
			// here — design.md §12.3 makes that yoroi-merger's job ("MERGING直前
			// にGitHubから全権威状態を再取得"), so this operation submits its
			// envelope and lets the merger's own authoritative re-fetch +
			// revalidation reject it if the base has moved.
			const envelope = await buildDecisionEnvelope(
				ctx,
				repo,
				repoRow,
				next,
				prInfo,
				operationId,
				lease.fencingToken,
			);
			await submitToMerger(ctx, envelope, repoId, next.prNumber);
		},
	);
}

async function promotePassedPrsToQueue(ctx: ControlContext, repoId: string): Promise<void> {
	const passed = await ctx.db
		.select({ prNumber: prDecisionSnapshot.prNumber })
		.from(prDecisionSnapshot)
		.where(and(eq(prDecisionSnapshot.repoId, repoId), eq(prDecisionSnapshot.allGatesPassed, true)));

	for (const { prNumber } of passed) {
		await ctx.db
			.insert(queueEntry)
			.values({ repoId, prNumber, lane: "default", risk: "medium" })
			.onConflictDoNothing({ target: [queueEntry.repoId, queueEntry.prNumber] });
	}

	// gateが崩れたPRはqueueから外す(§5.1 QUEUED→REVIEWING相当)
	const failing = await ctx.db
		.select({ prNumber: prDecisionSnapshot.prNumber })
		.from(prDecisionSnapshot)
		.where(
			and(eq(prDecisionSnapshot.repoId, repoId), eq(prDecisionSnapshot.allGatesPassed, false)),
		);
	for (const { prNumber } of failing) {
		await ctx.db.delete(queueEntry).where(
			and(eq(queueEntry.repoId, repoId), eq(queueEntry.prNumber, prNumber)),
		);
	}
}

async function buildDecisionEnvelope(
	ctx: ControlContext,
	repo: RepoRef,
	repoRow: { readonly installationId: number },
	queueRow: { readonly prNumber: number },
	prInfo: { readonly headSha: string; readonly baseSha: string; readonly baseRef: string },
	operationId: string,
	fencingToken: bigint,
): Promise<DecisionEnvelope> {
	const approvals = await ctx.db
		.select()
		.from(approvalTable)
		.where(
			and(
				eq(approvalTable.repoId, `${repo.owner}/${repo.name}`),
				eq(approvalTable.prNumber, queueRow.prNumber),
				eq(approvalTable.maintained, true),
			),
		);

	const scopeIds = [...new Set(approvals.map((a) => a.scopeId))];
	const scopeReviewProofs: DecisionEnvelope["scopeReviewProofs"] = {};
	for (const scopeId of scopeIds) {
		// MVP: no `scope_snapshot` table (design.md §6.5) exists in this pass's
		// schema to read the *real* per-scope change/result digest back from —
		// these are derived, reproducible digests over the scope+PR+head
		// identity instead of the true content digest. apps/merger's
		// revalidation still re-derives gate state from GitHub directly before
		// merging, so this doesn't weaken the merge-time safety check itself;
		// it only means the envelope's own scopeReviewProofs are a traceability
		// placeholder, not yet the byte-exact §8.2 digest.
		const basis = `${repo.owner}/${repo.name}:${queueRow.prNumber}:${scopeId}:${prInfo.headSha}`;
		const digest = await sha256HexOfString(basis);
		scopeReviewProofs[scopeId] = {
			changeDigest: digest,
			resultDigest: digest,
			contextProofDigest: digest,
		};
	}

	const compiled = await compilePolicy(DEFAULT_POLICY, null, null);
	const policyDigest = compiled.ok
		? compiled.value.digest
		: await sha256HexOfString("default-policy");
	const approvalDigest = await sha256HexOfString(JSON.stringify(approvals.map((a) => a.id)));
	const checkPlanDigest = await sha256HexOfString(`${queueRow.prNumber}:${prInfo.headSha}`);
	const evidenceDigest = await sha256HexOfString(`${operationId}:${prInfo.headSha}`);

	const envelope = {
		operationId,
		installationId: repoRow.installationId,
		repositoryId: repo.repositoryId,
		owner: repo.owner,
		repoName: repo.name,
		pullRequestNumber: queueRow.prNumber,
		headSha: prInfo.headSha,
		baseSha: prInfo.baseSha,
		baseRef: prInfo.baseRef,
		dependencyShas: [],
		candidateSha: prInfo.headSha,
		scopeReviewProofs,
		policyDigest,
		approvalDigest,
		checkPlanDigest,
		evidenceDigest,
		fencingToken: fencingToken.toString(),
		denoRevisionId: Deno.env.get("DENO_DEPLOYMENT_ID") ?? "local-dev",
		expiresAt: new Date(Date.now() + ENVELOPE_TTL_MS).toISOString(),
	};

	const parsed = DecisionEnvelopeSchema.parse(envelope);
	return parsed;
}

async function submitToMerger(
	ctx: ControlContext,
	envelope: DecisionEnvelope,
	repoId: string,
	prNumber: number,
): Promise<void> {
	// MVP shared-key signing (see apps/control/src/lib/identity-issuer.ts's
	// comment) — the same interim mechanism as console→control auth.
	const key = await importHmacEnvelopeKey(mustGetEnv("YOROI_MERGER_SHARED_TOKEN"));
	const signature = await signEnvelope(envelope, key);
	const idToken = await ctx.identityIssuer.getOidcToken("yoroi-merger");

	let response: Response;
	try {
		response = await fetch(`${ctx.mergerBaseUrl}/internal/merge`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-deno-oidc-token": idToken,
			},
			body: JSON.stringify({ envelope, signature }),
		});
	} catch (error) {
		await appendDecisionEvent(ctx.db, {
			operationId: envelope.operationId,
			repoId,
			prNumber,
			actorStableId: null,
			operation: "merge",
			fromState: "GATE_PASSED",
			toState: null,
			reasonCode: "merger_unreachable",
			result: "failure",
			evidence: { error: error instanceof Error ? error.message : String(error) },
		});
		return;
	}

	const body = await response.json().catch(() => ({}));
	await appendDecisionEvent(ctx.db, {
		operationId: envelope.operationId,
		repoId,
		prNumber,
		actorStableId: null,
		operation: "merge",
		fromState: "GATE_PASSED",
		toState: response.ok ? "MERGED" : null,
		reasonCode: response.ok ? "gate_passed" : `merger_rejected_${response.status}`,
		result: response.ok ? "success" : "failure",
		evidence: body,
	});
}
