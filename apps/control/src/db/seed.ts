import { sql } from "drizzle-orm";
import { db } from "./client.ts";
import {
	approval,
	approvalCarryForward,
	blockedEntry,
	decisionEvent,
	flakyTest,
	fleetHealthSnapshot,
	mergeCandidate,
	policyBundle,
	prDecisionSnapshot,
	prReviewerAssignment,
	prScopeRequirement,
	pullRequestRevision,
	queueEntry,
	repository,
} from "@yoroi/postgres";
import { getEnv } from "../env.ts";
import { DEFAULT_POLICY } from "../worker/default-policy.ts";

/** r1's policyVersion below is deliberately set to match this bundle's
 * digest, so the Policy & Drift screen's local demo shows both code paths:
 * r1 resolves to a published bundle, r2/r3 fall back to DEFAULT_POLICY
 * (matching production reality today — see routes/policy.ts's comment). */
const R1_POLICY_DIGEST = "v13-payments-override (sha256:44f1a9…)";

/**
 * Sample data with the same shape/content as the console app's former
 * `mock-control-api.ts`, now persisted in Postgres via real inserts instead
 * of hardcoded in-memory arrays. Re-runnable: truncates first.
 *
 * `MyWork` (authored PRs, review assignments) is scoped to one actor id.
 * Set YOROI_SEED_ACTOR_ID to your real Better Auth user id before seeding
 * so the My Work screen shows data for whoever you log in as locally;
 * defaults to 'dev-actor'.
 */

const DEV_ACTOR = getEnv("YOROI_SEED_ACTOR_ID", "dev-actor");
const now = Date.now();
const minutesAgo = (n: number) => new Date(now - n * 60_000);
const minutesFromNow = (n: number) => new Date(now + n * 60_000);

async function truncateAll() {
	await db.execute(sql`
		TRUNCATE TABLE
			repository, pull_request_revision, approval, pr_scope_requirement,
			queue_entry, pr_decision_snapshot, pr_reviewer_assignment, blocked_entry,
			feedback_case, decision_event, fleet_health_snapshot,
			flaky_test, merge_candidate, policy_bundle, approval_carry_forward,
			expected_check_plan, check_evidence
		RESTART IDENTITY
	`);
}

async function seedRepositories() {
	await db.insert(repository).values([
		{
			repoId: "r1",
			installationId: 1,
			githubRepositoryId: 1001,
			name: "acme/payments-api",
			mode: "serial",
			status: "active",
			openPrs: 14,
			gatePassRatePct: 92,
			ciSuccessRatePct: 88,
			p50LeadTimeMinutes: 47,
			targetBranch: "main",
			policyVersion: R1_POLICY_DIGEST,
			rulesetConsistent: true,
			installationOk: true,
			lastWebhookAt: minutesAgo(1),
			lastReconcileAt: minutesAgo(2),
			flakyRatePct: 3,
			rebuildRatePct: 5,
			batchSplitRatePct: 0,
			autoRevertRatePct: 1,
			metrics: {
				leadTime: { p50: 47, p95: 210 },
				reviewWait: { p50: 22, p95: 96 },
				ciDuration: { p50: 9, p95: 24 },
				queueWait: { p50: 6, p95: 31 },
				internalTime: { p50: 1, p95: 4 },
			},
		},
		{
			repoId: "r2",
			installationId: 1,
			githubRepositoryId: 1002,
			name: "acme/web-frontend",
			mode: "speculative",
			status: "active",
			openPrs: 31,
			gatePassRatePct: 85,
			ciSuccessRatePct: 79,
			p50LeadTimeMinutes: 63,
			targetBranch: "main",
			policyVersion: "v9 (sha256:1c7e…)",
			rulesetConsistent: true,
			installationOk: true,
			lastWebhookAt: minutesAgo(3),
			lastReconcileAt: minutesAgo(7),
			flakyRatePct: 11,
			rebuildRatePct: 18,
			batchSplitRatePct: 4,
			autoRevertRatePct: 2,
			metrics: {
				leadTime: { p50: 63, p95: 340 },
				reviewWait: { p50: 40, p95: 180 },
				ciDuration: { p50: 14, p95: 38 },
				queueWait: { p50: 12, p95: 55 },
				internalTime: { p50: 2, p95: 6 },
			},
		},
		{
			repoId: "r3",
			installationId: 1,
			githubRepositoryId: 1003,
			name: "acme/infra-terraform",
			mode: "advisory",
			status: "paused",
			openPrs: 5,
			gatePassRatePct: 97,
			ciSuccessRatePct: 95,
			p50LeadTimeMinutes: 120,
			targetBranch: "main",
			policyVersion: "v4 (sha256:7ab0…)",
			rulesetConsistent: false,
			installationOk: true,
			lastWebhookAt: minutesAgo(80),
			lastReconcileAt: minutesAgo(85),
			flakyRatePct: 1,
			rebuildRatePct: 0,
			batchSplitRatePct: 0,
			autoRevertRatePct: 0,
			metrics: {
				leadTime: { p50: 120, p95: 480 },
				reviewWait: { p50: 80, p95: 300 },
				ciDuration: { p50: 20, p95: 60 },
				queueWait: { p50: 0, p95: 0 },
				internalTime: { p50: 1, p95: 3 },
			},
		},
	]);
}

async function seedPullRequests() {
	await db.insert(pullRequestRevision).values([
		{
			repoId: "r1",
			prNumber: 398,
			title: "Fix rounding in refund calculation",
			headSha: "8f21ac3",
			baseSha: "main",
			authorStableId: "someone",
			state: "queued",
			nextAction: "—",
		},
		{
			repoId: "r1",
			prNumber: 405,
			title: "Bump webhook payload limit",
			headSha: "a1b2c3d",
			baseSha: "main",
			authorStableId: DEV_ACTOR,
			state: "reviewing",
			nextAction: "Security Approverへ再レビューを依頼してください",
			revokedScopes: ["auth"],
			revokedScopesReason: "src/auth/session.ts の動作が変更されました",
		},
		{
			repoId: "r1",
			prNumber: 421,
			title: "Add idempotency key to charge API",
			headSha: "b2c3d4e",
			baseSha: "main",
			authorStableId: "someone-else",
			state: "reviewing",
			nextAction: "—",
		},
		{
			repoId: "r2",
			prNumber: 918,
			title: "Migrate session store to KV",
			headSha: "a13f902",
			baseSha: "main",
			authorStableId: DEV_ACTOR,
			state: "candidate_building",
			nextAction: "対応不要です。CI完了を待っています",
		},
		{
			repoId: "r2",
			prNumber: 933,
			title: "Rebuild candidate after #918 dependency",
			headSha: "c04e771",
			baseSha: "main",
			authorStableId: "someone",
			state: "candidate_building",
			nextAction: "—",
		},
		{
			repoId: "r2",
			prNumber: 940,
			title: "Retry flaky auth-session suite",
			headSha: "d5e6f70",
			baseSha: "main",
			authorStableId: "someone",
			state: "reviewing",
			nextAction: "—",
		},
		{
			repoId: "r3",
			prNumber: 77,
			title: "Rotate KMS key for evidence bucket",
			headSha: "e6f7081",
			baseSha: "main",
			authorStableId: "someone",
			state: "reviewing",
			nextAction: "—",
		},
	]);
}

async function seedApprovalsAndDecisions() {
	// r1/421 (design.md 24章 sample prDetails['r1/421']): waiting on Security
	// Approver for payments-core, db already approved and maintained.
	await db.insert(prScopeRequirement).values([
		{ repoId: "r1", prNumber: 421, scopeId: "payments-core", requiredRole: "security_approver" },
		{ repoId: "r1", prNumber: 421, scopeId: "db", requiredRole: "data_approver" },
		{ repoId: "r2", prNumber: 933, scopeId: "frontend", requiredRole: "scope_approver" },
		{ repoId: "r1", prNumber: 405, scopeId: "db", requiredRole: "data_approver" },
		{ repoId: "r1", prNumber: 405, scopeId: "auth", requiredRole: "security_approver" },
		{ repoId: "r2", prNumber: 918, scopeId: "frontend", requiredRole: "scope_approver" },
		{ repoId: "r2", prNumber: 918, scopeId: "session", requiredRole: "scope_approver" },
	]);

	await db.insert(approval).values([
		{
			repoId: "r1",
			prNumber: 421,
			scopeId: "db",
			actorStableId: "yuki-t",
			role: "data_approver",
			maintained: true,
		},
		{
			repoId: "r2",
			prNumber: 933,
			scopeId: "frontend",
			actorStableId: "k-sato",
			role: "scope_approver",
			maintained: true,
		},
		{
			repoId: "r1",
			prNumber: 405,
			scopeId: "db",
			actorStableId: "yuki-t",
			role: "data_approver",
			maintained: true,
		},
		{
			repoId: "r2",
			prNumber: 918,
			scopeId: "frontend",
			actorStableId: "k-sato",
			role: "scope_approver",
			maintained: true,
		},
		{
			repoId: "r2",
			prNumber: 918,
			scopeId: "session",
			actorStableId: "k-sato",
			role: "scope_approver",
			maintained: true,
		},
	]);

	// design.md §4.3/§8.3: r1/405's "db" approval (approval id 3 above, in
	// insertion order) survived a rebase because the scope's content proved
	// unchanged — carried forward instead of re-requested. Backs the Reviews
	// screen's carry-forward-rate stat (routes/reviewers.ts).
	await db.insert(approvalCarryForward).values([
		{
			originalApprovalId: 3,
			repoId: "r1",
			prNumber: 405,
			scopeId: "db",
			oldBaseSha: "a1b2c3d",
			oldHeadSha: "e4f5061",
			newBaseSha: "a1b2c3d",
			newHeadSha: "7890abc",
			contextProofDigest: "sha256:demo-carry-forward",
			proofAlgorithm: "deterministic-replay",
		},
	]);

	await db.insert(prDecisionSnapshot).values([
		{
			repoId: "r1",
			prNumber: 421,
			conclusion: { kind: "waiting_approval", role: "security_approver" },
			gates: [
				{
					gate: "g1",
					status: "waiting",
					reason: "Security Approverの承認が1件不足",
					nextAction: "Security Approverへ依頼",
					waitingOn: "Security Approver",
				},
				{
					gate: "g2",
					status: "passed",
					reason: "Candidateは最新mainと整合",
					nextAction: "—",
					waitingOn: null,
				},
				{
					gate: "g3",
					status: "passed",
					reason: "期待checkは全て成功",
					nextAction: "—",
					waitingOn: null,
				},
				{
					gate: "g4",
					status: "unknown",
					reason: "G1未成立のためlease未取得",
					nextAction: "—",
					waitingOn: null,
				},
			],
			checks: [
				{ job: "unit", expected: true, conclusion: "success", trustedRunner: true },
				{ job: "integration", expected: true, conclusion: "success", trustedRunner: true },
				{ job: "security-scan", expected: true, conclusion: "success", trustedRunner: true },
			],
			reasonGraph: {
				label: "Merge不可",
				children: [
					{
						label: "G1 Identity / Approval未成立",
						children: [{ label: "payments-core scopeのSecurity Approver承認が0件", children: [] }],
					},
				],
			},
			allGatesPassed: false,
			hasCiFailure: false,
		},
		{
			repoId: "r2",
			prNumber: 933,
			conclusion: { kind: "rebuilding" },
			gates: [
				{
					gate: "g1",
					status: "passed",
					reason: "承認は充足済み",
					nextAction: "—",
					waitingOn: null,
				},
				{
					gate: "g2",
					status: "waiting",
					reason: "先行PR #918失敗によりcandidate再構築中",
					nextAction: "—",
					waitingOn: null,
				},
				{
					gate: "g3",
					status: "unknown",
					reason: "candidate確定後に再評価",
					nextAction: "—",
					waitingOn: null,
				},
				{ gate: "g4", status: "unknown", reason: "G2未成立", nextAction: "—", waitingOn: null },
			],
			checks: [{ job: "unit", expected: true, conclusion: "pending", trustedRunner: true }],
			reasonGraph: {
				label: "Merge不可",
				children: [
					{
						label: "G2 Candidate Integrity未成立",
						children: [
							{
								label: "candidate再構築中",
								children: [{ label: "先行PR #918がqueueから離脱", children: [] }],
							},
						],
					},
				],
			},
			allGatesPassed: false,
			hasCiFailure: false,
		},
		{
			repoId: "r1",
			prNumber: 398,
			conclusion: { kind: "waiting_ci" },
			gates: [
				{
					gate: "g1",
					status: "passed",
					reason: "承認は充足済み",
					nextAction: "—",
					waitingOn: null,
				},
				{
					gate: "g2",
					status: "passed",
					reason: "Candidateは最新mainと整合",
					nextAction: "—",
					waitingOn: null,
				},
				{ gate: "g3", status: "waiting", reason: "CI実行中", nextAction: "—", waitingOn: null },
				{ gate: "g4", status: "unknown", reason: "G3未成立", nextAction: "—", waitingOn: null },
			],
			checks: [
				{ job: "unit", expected: true, conclusion: "pending", trustedRunner: true },
				{ job: "integration", expected: true, conclusion: "pending", trustedRunner: true },
			],
			reasonGraph: {
				label: "Merge不可",
				children: [{
					label: "G3 Test Evidence未成立",
					children: [{ label: "CI実行中", children: [] }],
				}],
			},
			allGatesPassed: false,
			hasCiFailure: false,
		},
		{
			repoId: "r2",
			prNumber: 918,
			conclusion: { kind: "waiting_ci" },
			gates: [
				{
					gate: "g1",
					status: "passed",
					reason: "承認は充足済み",
					nextAction: "—",
					waitingOn: null,
				},
				{
					gate: "g2",
					status: "passed",
					reason: "Candidateは最新mainと整合",
					nextAction: "—",
					waitingOn: null,
				},
				{
					gate: "g3",
					status: "waiting",
					reason: "integration-test実行中",
					nextAction: "—",
					waitingOn: null,
				},
				{ gate: "g4", status: "unknown", reason: "G3未成立", nextAction: "—", waitingOn: null },
			],
			checks: [{
				job: "integration-test",
				expected: true,
				conclusion: "pending",
				trustedRunner: true,
			}],
			reasonGraph: {
				label: "Merge不可",
				children: [{
					label: "G3 Test Evidence未成立",
					children: [{ label: "integration-test実行中", children: [] }],
				}],
			},
			allGatesPassed: false,
			hasCiFailure: false,
		},
	]);
}

async function seedQueue() {
	await db.insert(queueEntry).values([
		{
			repoId: "r1",
			prNumber: 398,
			lane: "hotfix",
			risk: "medium",
			priority: 30,
			enqueuedAt: minutesAgo(8),
			candidateSha: "8f21ac3",
			runningChecks: ["unit", "integration"],
			rebuildCount: 0,
			etaFrom: minutesFromNow(5),
			etaTo: minutesFromNow(12),
			etaConfidence: "high",
		},
		{
			repoId: "r2",
			prNumber: 918,
			lane: "default",
			risk: "medium",
			priority: 10,
			enqueuedAt: minutesAgo(22),
			candidateSha: "a13f902",
			runningChecks: ["integration-test"],
			rebuildCount: 1,
			etaFrom: minutesFromNow(20),
			etaTo: minutesFromNow(40),
			etaConfidence: "medium",
		},
		{
			repoId: "r2",
			prNumber: 933,
			lane: "default",
			risk: "low",
			priority: 5,
			enqueuedAt: minutesAgo(19),
			candidateSha: "c04e771",
			runningChecks: [],
			rebuildCount: 2,
			rebuildNoticeCausePr: 918,
			etaFrom: minutesFromNow(45),
			etaTo: minutesFromNow(75),
			etaConfidence: "medium",
		},
		{
			repoId: "r1",
			prNumber: 421,
			lane: "high_risk",
			risk: "high",
			priority: 0,
			enqueuedAt: minutesAgo(340),
			candidateSha: "—",
			runningChecks: [],
		},
	]);
}

async function seedReviewAssignments() {
	await db.insert(prReviewerAssignment).values([
		{
			repoId: "r1",
			prNumber: 421,
			scopeId: "payments-core",
			actorStableId: DEV_ACTOR,
			reason: "payments-coreのSecurity Approverとして登録されています",
			sensitive: true,
			estimatedReviewMinutes: 25,
			waitingSince: minutesAgo(5 * 60 + 40),
		},
		{
			repoId: "r3",
			prNumber: 77,
			scopeId: "infra-secrets",
			actorStableId: DEV_ACTOR,
			reason: "infra-secretsのInfra Approverとして登録されています",
			sensitive: true,
			estimatedReviewMinutes: 15,
			waitingSince: minutesAgo(26 * 60),
		},
		// Below: other actors, not DEV_ACTOR — My Work only shows the logged-in
		// actor's own assignments, but the Reviews screen (design.md §23.10)
		// shows load across everyone, so it needs more than one reviewer to be
		// a meaningful demo (backup-reviewer coverage, concentration).
		{
			repoId: "r1",
			prNumber: 421,
			scopeId: "payments-core",
			actorStableId: "yuki-t",
			reason: "payments-coreの backup Security Approverとして登録されています",
			sensitive: true,
			estimatedReviewMinutes: 25,
			waitingSince: minutesAgo(3 * 60),
		},
		{
			repoId: "r2",
			prNumber: 933,
			scopeId: "frontend",
			actorStableId: "k-sato",
			reason: "frontendのScope Approverとして登録されています",
			sensitive: false,
			estimatedReviewMinutes: 10,
			waitingSince: minutesAgo(45),
		},
		{
			repoId: "r2",
			prNumber: 918,
			scopeId: "frontend",
			actorStableId: "k-sato",
			reason: "frontendのScope Approverとして登録されています",
			sensitive: false,
			estimatedReviewMinutes: 20,
			waitingSince: minutesAgo(2 * 60),
		},
	]);
}

async function seedBlocked() {
	await db.insert(blockedEntry).values([
		{
			repoId: "r1",
			prNumber: 421,
			responsibility: "other_reviewer",
			reason: "Security Approverの承認が1件不足しています",
			nextActor: "Security Approver",
			etaFrom: minutesFromNow(60),
			etaTo: minutesFromNow(150),
			etaConfidence: "medium",
		},
		{
			repoId: "r2",
			prNumber: 918,
			responsibility: "ci",
			reason: "integration-test が実行中です",
			nextActor: "—",
			etaFrom: minutesFromNow(10),
			etaTo: minutesFromNow(30),
			etaConfidence: "high",
		},
		{
			repoId: "r2",
			prNumber: 933,
			responsibility: "queue",
			reason: "先行PR #918 の失敗によりcandidateを再構築中です",
			nextActor: "—",
			etaFrom: minutesFromNow(40),
			etaTo: minutesFromNow(70),
			etaConfidence: "medium",
		},
		{
			repoId: "r1",
			prNumber: 405,
			responsibility: "your_action",
			reason: "scope変更に伴う再承認が必要です",
			nextActor: "あなた",
		},
		{
			repoId: "r3",
			prNumber: 77,
			responsibility: "policy_blocked",
			reason: "repoがOperatorによりpause中です",
			nextActor: "Operator",
		},
		{
			repoId: "r2",
			prNumber: 940,
			responsibility: "needs_investigation",
			reason: "context safety proofがindeterminateのため安全側で失効しました",
			nextActor: "Reviewer",
		},
	]);
}

async function seedAudit() {
	await db.insert(decisionEvent).values([
		{
			repoId: "r1",
			prNumber: 405,
			actorStableId: "yuki-t",
			operation: "approval",
			reasonCode: "scope_approved",
			result: "db scope承認",
			occurredAt: minutesAgo(30),
		},
		{
			repoId: "r1",
			prNumber: 398,
			actorStableId: "yoroi-merger",
			operation: "merge",
			reasonCode: "gate_passed",
			result: "success",
			evidence: { candidateSha: "8f21ac3" },
			occurredAt: minutesAgo(45),
		},
		{
			repoId: "r3",
			prNumber: null,
			actorStableId: "ops-taro",
			operation: "pause",
			reasonCode: "manual",
			result: "reason: KMSローテーション作業中",
			occurredAt: minutesAgo(120),
		},
	]);

	// Fill out FleetOverview.recent (merged/failed/autoReverted within 24h) with
	// plausible additional history beyond the 3 curated rows above.
	const filler = [];
	for (let i = 0; i < 8; i++) {
		filler.push({
			repoId: i % 2 === 0 ? "r1" : "r2",
			prNumber: 1000 + i,
			actorStableId: "yoroi-merger",
			operation: "merge",
			reasonCode: "gate_passed",
			result: "success",
			occurredAt: minutesAgo(50 + i * 40),
		});
	}
	for (let i = 0; i < 2; i++) {
		filler.push({
			repoId: "r2",
			prNumber: 2000 + i,
			actorStableId: "yoroi-merger",
			operation: "merge",
			reasonCode: "candidate_stale",
			result: "failure",
			occurredAt: minutesAgo(200 + i * 40),
		});
	}
	await db.insert(decisionEvent).values(filler);
}

/** design.md §23.11 Policy & Drift screen (Policy half — routes/policy.ts).
 * r1's `policyVersion` above matches this bundle's digest exactly, so the
 * demo shows a repo running a published org override; r2/r3 have no
 * matching bundle and fall back to DEFAULT_POLICY, same as production
 * reality today. `rawYaml` is a real, parseable `PolicyDocument` (a copy of
 * DEFAULT_POLICY with a stricter payments-core override) rather than
 * throwaway text, so it would compile for real if evaluate-pr.ts's
 * `loadEffectivePolicy` ever actually loaded it. */
async function seedPolicyBundle() {
	const orgOverride = {
		...DEFAULT_POLICY,
		scopes: [
			...DEFAULT_POLICY.scopes,
			{
				id: "payments-core",
				match: ["services/payments/**"],
				require: { approvals: [{ role: "security_approver" as const, count: 2 }] },
			},
		],
	};
	await db.insert(policyBundle).values([
		{
			digest: R1_POLICY_DIGEST,
			installationId: 1,
			repositoryId: 1001,
			version: "v13",
			rawYaml: JSON.stringify(orgOverride),
			signer: "yuki-t",
			createdAt: minutesAgo(14 * 24 * 60),
		},
	]);
}

/** design.md §23.9 CI Reliability screen (routes/ci.ts). `repositoryId`
 * below is the GitHub numeric id (`githubRepositoryId` set on the r1/r2
 * seed rows above), matching what the real `/yoroi flaky` command and
 * Serial scheduler key these tables by. */
async function seedCiSignals() {
	await db.insert(flakyTest).values([
		{
			testFingerprint: "acme/payments-api:integration/auth-session",
			repositoryId: 1001,
			ownerTeam: "payments-platform",
			failureCount: 18,
			reproductionRate: 62,
			status: "observed",
		},
		{
			testFingerprint: "acme/payments-api:unit/ledger-rounding",
			repositoryId: 1001,
			ownerTeam: "payments-platform",
			failureCount: 6,
			reproductionRate: 20,
			status: "quarantine_requested",
			quarantineUntil: minutesFromNow(3 * 24 * 60),
		},
		{
			testFingerprint: "acme/web-frontend:e2e/checkout-flow",
			repositoryId: 1002,
			ownerTeam: "web-platform",
			failureCount: 4,
			reproductionRate: 35,
			status: "observed",
		},
	]);

	await db.insert(mergeCandidate).values([
		{
			candidateSha: "cand-r1-0001",
			installationId: 1,
			repositoryId: 1001,
			pullRequestNumber: 405,
			baseSha: "a1b2c3d",
			orderedHeads: ["7890abc"],
			policyDigest: R1_POLICY_DIGEST,
			builtAt: minutesAgo(90),
		},
		{
			candidateSha: "cand-r1-0002",
			installationId: 1,
			repositoryId: 1001,
			pullRequestNumber: 421,
			baseSha: "7890abc",
			orderedHeads: ["f0e1d2c"],
			policyDigest: R1_POLICY_DIGEST,
			builtAt: minutesAgo(40),
			invalidatedAt: minutesAgo(35),
			invalidationReason: "base_branch_advanced",
		},
		{
			candidateSha: "cand-r2-0001",
			installationId: 1,
			repositoryId: 1002,
			pullRequestNumber: 933,
			baseSha: "b2c3d4e",
			orderedHeads: ["1a2b3c4"],
			policyDigest: "default",
			builtAt: minutesAgo(20),
			invalidatedAt: minutesAgo(18),
			invalidationReason: "base_branch_advanced",
		},
	]);
}

async function seedHealth() {
	await db.insert(fleetHealthSnapshot).values([
		{ installationId: 1, component: "control", status: "green", reason: "outbox lag 8秒" },
		{ installationId: 1, component: "merger", status: "green", reason: "直近1時間のmerge 6件" },
		{ installationId: 1, component: "console", status: "green", reason: "—" },
		{
			installationId: 1,
			component: "github_api",
			status: "amber",
			reason: "rate limit remaining 18%",
			metric: { rate_limit_remaining_pct: 18 },
		},
		{
			installationId: 1,
			component: "evidence_export",
			status: "green",
			reason: "直近日次検査でmissing envelopeなし",
		},
	]);
}

async function main() {
	console.log(`seeding yoroi-control sample data (actor: ${DEV_ACTOR})...`);
	await truncateAll();
	await seedRepositories();
	await seedPullRequests();
	await seedApprovalsAndDecisions();
	await seedQueue();
	await seedReviewAssignments();
	await seedBlocked();
	await seedAudit();
	await seedPolicyBundle();
	await seedCiSignals();
	await seedHealth();
	// feedback_case starts empty — populated via POST /api/pr/:repoId/:prNumber/feedback.
	console.log("done.");
}

await main();
Deno.exit(0);
