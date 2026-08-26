import { and, desc, eq, gt } from "drizzle-orm";
import type { OutboxWork } from "@yoroi/postgres";
import {
	appendDecisionEvent,
	decisionEvent,
	feedbackCase,
	flakyTest,
	prDecisionSnapshot,
	pullRequestRevision,
	queueEntry,
} from "@yoroi/postgres";
import type { RepoRef } from "@yoroi/github";
import {
	actorStableId as toActorStableId,
	installationId as toInstallationId,
	pullRequestNumber as toPullRequestNumber,
	repositoryId as toRepositoryId,
	sha as toSha,
} from "@yoroi/domain";
import { compilePolicy, evaluate, scopesForTouchedPaths } from "@yoroi/policy";
import {
	type CommandContext,
	type CommandPorts,
	dispatchCommand,
	type GateSnapshot,
	type QueueSnapshot,
} from "@yoroi/notifications";
import { withSpan } from "@yoroi/observability";
import type { ControlContext } from "../context.ts";
import { parseEventFacts } from "./event-facts.ts";
import { DEFAULT_POLICY } from "./default-policy.ts";

function buildPorts(ctx: ControlContext, repo: RepoRef): CommandPorts {
	return {
		async getGateSnapshot(_repo, pr) {
			const [row] = await ctx.db
				.select()
				.from(prDecisionSnapshot)
				.where(
					and(
						eq(prDecisionSnapshot.repoId, `${repo.owner}/${repo.name}`),
						eq(prDecisionSnapshot.prNumber, pr),
					),
				)
				.limit(1);
			if (!row) return null;
			return {
				headSha: toSha(""),
				gateConclusion: row.allGatesPassed ? "PASS" : "BLOCKED",
				reasonGraph: row.reasonGraph,
			};
		},

		async getQueueSnapshot(_repo, pr): Promise<QueueSnapshot | null> {
			const [row] = await ctx.db
				.select()
				.from(queueEntry)
				.where(
					and(eq(queueEntry.repoId, `${repo.owner}/${repo.name}`), eq(queueEntry.prNumber, pr)),
				)
				.limit(1);
			if (!row) return null;
			return {
				position: null,
				lane: row.lane,
				etaFrom: row.etaFrom,
				etaTo: row.etaTo,
				etaConfidence: row.etaConfidence,
			};
		},

		async refetchAuthoritativeHeadSha(r, pr) {
			const info = await ctx.github.getPullRequest(r, pr);
			return toSha(info.headSha);
		},

		async reevaluate(r, pr): Promise<GateSnapshot> {
			const prInfo = await ctx.github.getPullRequest(r, pr);
			const files = await ctx.github.listPullRequestFiles(r, pr);
			const compiled = await compilePolicy(DEFAULT_POLICY, null, null);
			if (!compiled.ok) throw new Error("DEFAULT_POLICY failed to compile");
			const touchedScopeIds = scopesForTouchedPaths(compiled.value, files.map((f) => f.filename));
			const result = evaluate(
				{
					candidate: { touchedScopeIds, isDraft: prInfo.isDraft },
					approvals: [],
					checks: [],
					queue: { repoStatus: "active" },
				},
				compiled.value,
			);
			return {
				headSha: toSha(prInfo.headSha),
				gateConclusion: result.gateConclusion,
				reasonGraph: result.reasonGraph,
			};
		},

		async tryAcquireCooldown(key, cooldownSeconds) {
			const since = new Date(Date.now() - cooldownSeconds * 1000);
			const [recent] = await ctx.db
				.select()
				.from(decisionEvent)
				.where(
					and(
						eq(decisionEvent.reasonCode, `cooldown:${key}`),
						gt(decisionEvent.occurredAt, since),
					),
				)
				.orderBy(desc(decisionEvent.occurredAt))
				.limit(1);
			if (recent) return false;
			await appendDecisionEvent(ctx.db, {
				operationId: null,
				repoId: `${repo.owner}/${repo.name}`,
				prNumber: null,
				actorStableId: null,
				operation: "cooldown",
				fromState: null,
				toState: null,
				reasonCode: `cooldown:${key}`,
				result: "acquired",
				evidence: {},
			});
			return true;
		},

		async recordAuditEvent(input) {
			await appendDecisionEvent(ctx.db, {
				operationId: null,
				repoId: `${repo.owner}/${repo.name}`,
				prNumber: null,
				actorStableId: input.actorStableId,
				operation: input.kind,
				fromState: null,
				toState: null,
				reasonCode: `slash_command_${input.kind}`,
				result: "recorded",
				evidence: { before: input.before, after: input.after },
			});
		},

		async recordFlakyReport(input) {
			const fingerprint = `${repo.owner}/${repo.name}:${input.testId}`;
			await ctx.db
				.insert(flakyTest)
				.values({ testFingerprint: fingerprint, repositoryId: repo.repositoryId, failureCount: 1 })
				.onConflictDoUpdate({
					target: flakyTest.testFingerprint,
					set: { failureCount: 1 }, // MVP: overwrite rather than increment (no atomic counter helper here yet)
				});
			return { confidence: "possible_change_related", failureFingerprint: fingerprint };
		},

		async createFlakyQuarantineProposal(input) {
			const fingerprint = `${repo.owner}/${repo.name}:${input.testId}`;
			await ctx.db
				.insert(flakyTest)
				.values({
					testFingerprint: fingerprint,
					repositoryId: repo.repositoryId,
					ownerTeam: input.owner,
					quarantineUntil: input.expiresAt,
					status: "quarantine_requested",
				})
				.onConflictDoUpdate({
					target: flakyTest.testFingerprint,
					set: {
						ownerTeam: input.owner,
						quarantineUntil: input.expiresAt,
						status: "quarantine_requested",
					},
				});
			return { proposalId: `${fingerprint}:${input.expiresAt.getTime()}` };
		},

		async recordFeedback(input) {
			const [row] = await ctx.db
				.insert(feedbackCase)
				.values({
					repoId: `${repo.owner}/${repo.name}`,
					prNumber: input.pullRequestNumber,
					category: input.category,
					actorStableId: input.actorStableId,
					description: input.description,
				})
				.returning({ id: feedbackCase.id });
			if (!row) throw new Error("feedback_case insert returned no row");
			return { id: row.id };
		},
	};
}

/**
 * design.md §15's slash commands, triggered by `issue_comment` webhooks
 * routed here as `handle_slash_command` outbox items. Permission resolution
 * is a known MVP gap: `GitHubAdapter` has no collaborator-permission lookup
 * yet, so every commenter defaults to `"read"` (fail-closed, DP-03) except
 * the PR's own author (compared against the stored `author_stable_id`,
 * which grants `/yoroi recheck` via its `allowPrAuthor` rule) — real repo
 * write/operator detection is tracked as follow-up work, not silently
 * assumed.
 */
export function dispatchSlashCommand(ctx: ControlContext, work: OutboxWork): Promise<void> {
	return withSpan(
		"slash_command",
		{ repositoryId: toRepositoryId(work.repositoryId ?? 0) },
		async () => {
			const facts = parseEventFacts(work.payload);
			if (
				!facts.isIssueComment || !facts.commentBody || !facts.repoFullName ||
				facts.pullRequestNumber === null
			) {
				return;
			}
			if (!facts.commentActorNodeId) return;

			const [owner, name] = facts.repoFullName.split("/");
			if (!owner || !name) return;
			const repo: RepoRef = {
				installationId: toInstallationId(work.installationId),
				repositoryId: toRepositoryId(work.repositoryId ?? 0),
				owner,
				name,
			};
			const prNumber = toPullRequestNumber(facts.pullRequestNumber);

			const [prRow] = await ctx.db
				.select({
					authorStableId: pullRequestRevision.authorStableId,
					headSha: pullRequestRevision.headSha,
				})
				.from(pullRequestRevision)
				.where(
					and(
						eq(pullRequestRevision.repoId, facts.repoFullName),
						eq(pullRequestRevision.prNumber, facts.pullRequestNumber),
					),
				)
				.limit(1);

			const commandCtx: CommandContext = {
				repo,
				pullRequestNumber: prNumber,
				actorStableId: toActorStableId(facts.commentActorNodeId),
				repoPermission: "read",
				isPrAuthor: prRow?.authorStableId === facts.commentActorNodeId,
				observedHeadSha: toSha(prRow?.headSha ?? ""),
			};

			const result = await dispatchCommand(commandCtx, facts.commentBody, buildPorts(ctx, repo));
			if (result.kind === "ok" || result.kind === "pending") {
				await ctx.github.createComment(repo, prNumber, result.markdown);
			} else if (result.kind === "denied") {
				await ctx.github.createComment(repo, prNumber, `⚠️ ${result.reason}`);
			}
		},
	);
}
