import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	serial,
	smallint,
	text,
	timestamp,
	unique
} from 'drizzle-orm/pg-core';

/**
 * Drizzle schema for yoroi-control/yoroi-merger's shared PostgreSQL database
 * (design.md §6, §24.7 + MVP additions — see comments per table). Private to
 * these two apps; yoroi-console never connects to Postgres directly
 * (design.md §2.2) — it calls yoroi-control's HTTP API.
 *
 * Two families of tables:
 *  1. Dashboard/read-model tables (repository..fleet_health_snapshot below) —
 *     originally built as a standalone MVP for yoroi-console before the real
 *     engine existed; now they're real *projections* the engine writes to,
 *     not fixtures a seed script fabricates.
 *  2. Event-sourced engine tables (webhook_inbox..flaky_test below) — taken
 *     directly from design.md §6.3/§6.4/§6.6/§6.7/§14.1/§14.3.
 *
 * No cross-table foreign keys between the repoId/prNumber-keyed tables:
 * pull_request_revision's PK is the composite (repo_id, pr_number), and
 * wiring every child table to it needs table-level composite FKs for no real
 * integrity benefit at this stage. Left to application code.
 */

// ---------------------------------------------------------------------------
// Dashboard / read-model projections
//
// `.$type<...>()` narrowing below uses inline literal unions rather than
// importing apps/control/src/domain/types.ts's equivalents — packages/*
// must never depend on apps/* (wrong dependency direction; apps depend on
// packages, not the reverse), so the literal values are duplicated here
// deliberately, the same tolerance apps/control/src/domain/types.ts's own
// top comment already accepts for the mirrored console-side copy. Keep the
// literals in sync by hand if either changes.
// ---------------------------------------------------------------------------

type DashboardRole =
	| 'reviewer'
	| 'scope_approver'
	| 'security_approver'
	| 'data_approver'
	| 'infra_approver'
	| 'governor'
	| 'operator'
	| 'maintainer'
	| 'developer';

type DashboardEtaConfidence = 'low' | 'medium' | 'high';

type DashboardPrConclusion =
	| { kind: 'mergeable' }
	| { kind: 'waiting_ci' }
	| { kind: 'waiting_approval'; role: DashboardRole }
	| { kind: 'rebuilding' }
	| { kind: 'policy_violation' }
	| { kind: 'fail_closed' };

interface DashboardGateRow {
	gate: 'g1' | 'g2' | 'g3' | 'g4';
	status: 'passed' | 'waiting' | 'failed' | 'unknown';
	reason: string;
	nextAction: string;
	waitingOn: string | null;
}

interface DashboardCheckRow {
	job: string;
	expected: boolean;
	conclusion: 'success' | 'failure' | 'cancelled' | 'pending' | null;
	trustedRunner: boolean;
}

interface DashboardReasonGraphNode {
	label: string;
	children: DashboardReasonGraphNode[];
}

export const repository = pgTable('repository', {
	repoId: text('repo_id').primaryKey(),
	installationId: bigint('installation_id', { mode: 'number' }).notNull(),
	githubRepositoryId: bigint('github_repository_id', { mode: 'number' }),
	name: text('name').notNull(), // "owner/name"
	mode: text('mode').notNull().$type<'observe' | 'advisory' | 'serial' | 'speculative' | 'batch'>(),
	status: text('status').notNull().$type<'active' | 'paused' | 'draining'>(),
	targetBranch: text('target_branch').notNull().default('main'),
	policyVersion: text('policy_version').notNull().default(''),
	rulesetConsistent: boolean('ruleset_consistent').notNull().default(true),
	installationOk: boolean('installation_ok').notNull().default(true),
	lastWebhookAt: timestamp('last_webhook_at', { withTimezone: true }),
	lastReconcileAt: timestamp('last_reconcile_at', { withTimezone: true }),
	openPrs: integer('open_prs').notNull().default(0),
	gatePassRatePct: integer('gate_pass_rate_pct').notNull().default(0),
	ciSuccessRatePct: integer('ci_success_rate_pct').notNull().default(0),
	p50LeadTimeMinutes: integer('p50_lead_time_minutes').notNull().default(0),
	flakyRatePct: integer('flaky_rate_pct').notNull().default(0),
	rebuildRatePct: integer('rebuild_rate_pct').notNull().default(0),
	batchSplitRatePct: integer('batch_split_rate_pct').notNull().default(0),
	autoRevertRatePct: integer('auto_revert_rate_pct').notNull().default(0),
	metrics: jsonb('metrics').notNull().$type<{
		leadTime: { p50: number; p95: number };
		reviewWait: { p50: number; p95: number };
		ciDuration: { p50: number; p95: number };
		queueWait: { p50: number; p95: number };
		internalTime: { p50: number; p95: number };
	}>(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const pullRequestRevision = pgTable(
	'pull_request_revision',
	{
		repoId: text('repo_id').notNull(),
		prNumber: integer('pr_number').notNull(),
		title: text('title').notNull().default(''),
		headSha: text('head_sha').notNull(),
		baseSha: text('base_sha').notNull(),
		isDraft: boolean('is_draft').notNull().default(false),
		authorStableId: text('author_stable_id').notNull(),
		state: text('state')
			.notNull()
			.$type<
				| 'discovered'
				| 'draft'
				| 'reviewing'
				| 'approval_covered'
				| 'prechecked'
				| 'queued'
				| 'candidate_building'
				| 'gate_passed'
				| 'merging'
				| 'merged'
				| 'observing'
				| 'superseded'
				| 'paused'
				| 'quarantined'
				| 'reverting'
			>(),
		stateVersion: integer('state_version').notNull().default(0),
		nextAction: text('next_action').notNull().default(''),
		revokedScopes: text('revoked_scopes').array(),
		revokedScopesReason: text('revoked_scopes_reason'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		primaryKey({ columns: [t.repoId, t.prNumber] }),
		index('idx_pr_revision_author').on(t.authorStableId)
	]
);

export const approval = pgTable(
	'approval',
	{
		id: serial('id').primaryKey(),
		repoId: text('repo_id').notNull(),
		prNumber: integer('pr_number').notNull(),
		scopeId: text('scope_id').notNull(),
		actorStableId: text('actor_stable_id').notNull(),
		role: text('role').notNull().$type<DashboardRole>(),
		maintained: boolean('maintained').notNull().default(true),
		approvedAt: timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		revokeReason: text('revoke_reason')
	},
	(t) => [index('idx_approval_pr').on(t.repoId, t.prNumber)]
);

export const prScopeRequirement = pgTable(
	'pr_scope_requirement',
	{
		id: serial('id').primaryKey(),
		repoId: text('repo_id').notNull(),
		prNumber: integer('pr_number').notNull(),
		scopeId: text('scope_id').notNull(),
		requiredRole: text('required_role').notNull().$type<DashboardRole>()
	},
	(t) => [index('idx_scope_requirement_pr').on(t.repoId, t.prNumber)]
);

export const queueEntry = pgTable(
	'queue_entry',
	{
		id: serial('id').primaryKey(),
		repoId: text('repo_id').notNull(),
		prNumber: integer('pr_number').notNull(),
		lane: text('lane')
			.notNull()
			.$type<'default' | 'hotfix' | 'high_risk' | 'mega'>()
			.default('default'),
		risk: text('risk').notNull().$type<'low' | 'medium' | 'high'>().default('medium'),
		priority: integer('priority').notNull().default(0),
		enqueuedAt: timestamp('enqueued_at', { withTimezone: true }).notNull().defaultNow(),
		candidateSha: text('candidate_sha').notNull().default('—'),
		runningChecks: text('running_checks').array(),
		rebuildCount: integer('rebuild_count').notNull().default(0),
		rebuildNoticeCausePr: integer('rebuild_notice_cause_pr'),
		etaFrom: timestamp('eta_from', { withTimezone: true }),
		etaTo: timestamp('eta_to', { withTimezone: true }),
		etaConfidence: text('eta_confidence').$type<DashboardEtaConfidence>(),
		state: text('state').notNull().default('waiting')
	},
	(t) => [
		index('idx_queue_order').on(t.priority, t.enqueuedAt),
		unique('uq_queue_pr').on(t.repoId, t.prNumber)
	]
);

export const prDecisionSnapshot = pgTable(
	'pr_decision_snapshot',
	{
		repoId: text('repo_id').notNull(),
		prNumber: integer('pr_number').notNull(),
		conclusion: jsonb('conclusion').notNull().$type<DashboardPrConclusion>(),
		gates: jsonb('gates').notNull().$type<DashboardGateRow[]>(),
		checks: jsonb('checks').notNull().$type<DashboardCheckRow[]>(),
		reasonGraph: jsonb('reason_graph').notNull().$type<DashboardReasonGraphNode>(),
		allGatesPassed: boolean('all_gates_passed').notNull().default(false),
		hasCiFailure: boolean('has_ci_failure').notNull().default(false),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.repoId, t.prNumber] })]
);

export const prReviewerAssignment = pgTable(
	'pr_reviewer_assignment',
	{
		id: serial('id').primaryKey(),
		repoId: text('repo_id').notNull(),
		prNumber: integer('pr_number').notNull(),
		scopeId: text('scope_id').notNull(),
		actorStableId: text('actor_stable_id').notNull(),
		reason: text('reason').notNull().default(''),
		sensitive: boolean('sensitive').notNull().default(false),
		estimatedReviewMinutes: integer('estimated_review_minutes').notNull().default(0),
		waitingSince: timestamp('waiting_since', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('idx_reviewer_assignment_actor').on(t.actorStableId)]
);

export const blockedEntry = pgTable(
	'blocked_entry',
	{
		id: serial('id').primaryKey(),
		repoId: text('repo_id').notNull(),
		prNumber: integer('pr_number').notNull(),
		responsibility: text('responsibility')
			.notNull()
			.$type<
				| 'your_action'
				| 'other_reviewer'
				| 'ci'
				| 'queue'
				| 'yoroi_internal'
				| 'github_outage'
				| 'policy_blocked'
				| 'needs_investigation'
			>(),
		reason: text('reason').notNull(),
		nextActor: text('next_actor').notNull(),
		etaFrom: timestamp('eta_from', { withTimezone: true }),
		etaTo: timestamp('eta_to', { withTimezone: true }),
		etaConfidence: text('eta_confidence').$type<DashboardEtaConfidence>(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('idx_blocked_responsibility').on(t.responsibility),
		unique('uq_blocked_pr').on(t.repoId, t.prNumber)
	]
);

export const feedbackCase = pgTable('feedback_case', {
	id: serial('id').primaryKey(),
	repoId: text('repo_id').notNull(),
	prNumber: integer('pr_number'),
	category: text('category').notNull(),
	actorStableId: text('actor_stable_id').notNull(),
	description: text('description').notNull().default(''),
	disposition: text('disposition'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	resolvedAt: timestamp('resolved_at', { withTimezone: true })
});

/** Append-only in application code. design.md §6.7's DB-role-level
 * `REVOKE UPDATE, DELETE` is follow-up hardening (not set up for this MVP
 * database's single app role) — `operation`/`result` are MVP additions for
 * AuditEntry. `prevHash`/`rowHash` (0003 migration) back the AT-19 hash
 * chain — every production write path populates them via this package's own
 * `appendDecisionEvent` (packages/postgres/src/decision-log.ts), never a raw
 * `db.insert`. Nullable at the column level for schema back-compat and
 * because `apps/control/src/db/seed.ts`'s synthetic demo rows intentionally
 * backdate `occurredAt` (for realistic-looking aging in local dev), which
 * `appendDecisionEvent` doesn't support — seed rows are excluded from
 * `loadDecisionEventChain`/`verifyChain` expectations by design, not by
 * oversight. */
export const decisionEvent = pgTable(
	'decision_event',
	{
		seq: serial('seq').primaryKey(),
		operationId: text('operation_id'),
		repoId: text('repo_id').notNull(),
		prNumber: integer('pr_number'),
		actorStableId: text('actor_stable_id'),
		operation: text('operation').notNull(),
		fromState: text('from_state'),
		toState: text('to_state'),
		reasonCode: text('reason_code').notNull().default(''),
		result: text('result').notNull().default(''),
		evidence: jsonb('evidence')
			.notNull()
			.$defaultFn(() => ({})),
		prevHash: text('prev_hash'),
		rowHash: text('row_hash'),
		occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('idx_decision_event_occurred').on(t.occurredAt),
		index('idx_decision_event_operation').on(t.operationId)
	]
);

/** design.md §24.7, verbatim. */
export const fleetHealthSnapshot = pgTable(
	'fleet_health_snapshot',
	{
		installationId: bigint('installation_id', { mode: 'number' }).notNull(),
		component: text('component')
			.notNull()
			.$type<'control' | 'merger' | 'console' | 'github_api' | 'evidence_export'>(),
		status: text('status').notNull().$type<'green' | 'amber' | 'red'>(),
		metric: jsonb('metric')
			.notNull()
			.$defaultFn(() => ({})),
		reason: text('reason'),
		observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.installationId, t.component] })]
);

// ---------------------------------------------------------------------------
// Event-sourced engine tables (design.md §6.3, §6.4, §6.6, §6.7, §14.1, §14.3)
// ---------------------------------------------------------------------------

/** design.md §6.3. */
export const webhookInbox = pgTable(
	'webhook_inbox',
	{
		id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
		installationId: bigint('installation_id', { mode: 'number' }).notNull(),
		repositoryId: bigint('repository_id', { mode: 'number' }),
		deliveryId: text('delivery_id').notNull(),
		eventType: text('event_type').notNull(),
		payloadDigest: text('payload_digest').notNull(),
		payloadEncrypted: text('payload_encrypted'), // base64; encryption is a follow-up (see notes below)
		receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp('expires_at', { withTimezone: true })
	},
	(t) => [
		unique('uq_webhook_inbox_delivery').on(t.installationId, t.deliveryId),
		index('idx_webhook_inbox_repo').on(t.repositoryId, t.receivedAt)
	]
);

/** design.md §6.3. */
export const workOutbox = pgTable(
	'work_outbox',
	{
		id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
		operationId: text('operation_id').notNull().unique(),
		installationId: bigint('installation_id', { mode: 'number' }).notNull(),
		repositoryId: bigint('repository_id', { mode: 'number' }),
		kind: text('kind').notNull(),
		payload: jsonb('payload').notNull(),
		state: text('state').notNull().default('pending'), // pending|leased|done|dead
		priority: smallint('priority').notNull().default(0),
		attempt: integer('attempt').notNull().default(0),
		maxAttempt: integer('max_attempt').notNull().default(8),
		availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
		leaseOwner: text('lease_owner'),
		leaseUntil: timestamp('lease_until', { withTimezone: true }),
		lastError: text('last_error'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('idx_outbox_claim').on(t.state, t.availableAt)]
);

/** design.md §6.4. */
export const branchCoordinator = pgTable(
	'branch_coordinator',
	{
		installationId: bigint('installation_id', { mode: 'number' }).notNull(),
		repositoryId: bigint('repository_id', { mode: 'number' }).notNull(),
		targetBranch: text('target_branch').notNull(),
		holderOperationId: text('holder_operation_id'),
		leaseUntil: timestamp('lease_until', { withTimezone: true }),
		fencingToken: bigint('fencing_token', { mode: 'bigint' }).notNull().default(0n),
		expectedBaseSha: text('expected_base_sha'),
		stateVersion: bigint('state_version', { mode: 'bigint' }).notNull().default(0n),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.installationId, t.repositoryId, t.targetBranch] })]
);

/** design.md §6.6. */
export const mergeCandidate = pgTable('merge_candidate', {
	candidateSha: text('candidate_sha').primaryKey(),
	installationId: bigint('installation_id', { mode: 'number' }).notNull(),
	repositoryId: bigint('repository_id', { mode: 'number' }).notNull(),
	pullRequestNumber: integer('pull_request_number').notNull(),
	baseSha: text('base_sha').notNull(),
	orderedHeads: text('ordered_heads').array().notNull(),
	policyDigest: text('policy_digest').notNull(),
	builtAt: timestamp('built_at', { withTimezone: true }).notNull().defaultNow(),
	invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
	invalidationReason: text('invalidation_reason')
});

/** design.md §6.6. */
export const expectedCheckPlan = pgTable('expected_check_plan', {
	id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
	candidateSha: text('candidate_sha').notNull(),
	jobName: text('job_name').notNull(),
	reason: text('reason').notNull(),
	required: boolean('required').notNull().default(true)
});

/** design.md §6.6. */
export const checkEvidence = pgTable(
	'check_evidence',
	{
		id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
		candidateSha: text('candidate_sha').notNull(),
		jobName: text('job_name').notNull(),
		workflowSha: text('workflow_sha').notNull(),
		runnerClass: text('runner_class'),
		trustedRunner: boolean('trusted_runner').notNull().default(true), // MVP addition: §13.1's design doesn't say how "trusted" is derived from runner_class; stored directly instead
		inputDigest: text('input_digest'),
		artifactDigest: text('artifact_digest'),
		conclusion: text('conclusion').notNull(), // success|failure|cancelled|timed_out
		observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [unique('uq_check_evidence').on(t.candidateSha, t.jobName)]
);

/** design.md §6.7. */
export const policyBundle = pgTable('policy_bundle', {
	digest: text('digest').primaryKey(),
	installationId: bigint('installation_id', { mode: 'number' }),
	repositoryId: bigint('repository_id', { mode: 'number' }),
	version: text('version').notNull(),
	rawYaml: text('raw_yaml').notNull(),
	signer: text('signer'),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

/** design.md §14.1. */
export const notificationAnchor = pgTable(
	'notification_anchor',
	{
		installationId: bigint('installation_id', { mode: 'number' }).notNull(),
		repositoryId: bigint('repository_id', { mode: 'number' }).notNull(),
		pullRequestNumber: integer('pull_request_number').notNull(),
		summaryCommentId: bigint('summary_comment_id', { mode: 'number' }),
		checkRunId: bigint('check_run_id', { mode: 'number' }),
		lastReasonHash: text('last_reason_hash'),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.installationId, t.repositoryId, t.pullRequestNumber] })]
);

/** design.md §14.3. */
export const notification = pgTable(
	'notification',
	{
		id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
		decisionId: text('decision_id').notNull(),
		audience: text('audience').notNull(),
		reasonCode: text('reason_code').notNull(),
		coalesceKey: text('coalesce_key').notNull(),
		category: text('category').notNull(), // blocker|action_required|informational
		dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('idx_notification_coalesce').on(t.coalesceKey, t.dispatchedAt)]
);

/** design.md §6.7. */
export const configSnapshot = pgTable('config_snapshot', {
	id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
	resourceId: text('resource_id').notNull(),
	desiredDigest: text('desired_digest'),
	actualDigest: text('actual_digest'),
	drifted: boolean('drifted').notNull().default(false),
	observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow()
});

/** design.md §6.7. */
export const flakyTest = pgTable('flaky_test', {
	testFingerprint: text('test_fingerprint').primaryKey(),
	repositoryId: bigint('repository_id', { mode: 'number' }).notNull(),
	ownerTeam: text('owner_team'),
	failureCount: integer('failure_count').notNull().default(0),
	reproductionRate: integer('reproduction_rate'), // stored as integer percent (0-100); design shows REAL, kept simple here
	quarantineUntil: timestamp('quarantine_until', { withTimezone: true }),
	status: text('status').notNull().default('observed')
});

/** design.md §6.5, §7.2's carry-forward display requirement (AT-04A/04F):
 * one row per (approval, scope) pair whose content was judged unchanged
 * across a rebase/force-push, carrying everything the console's My Work
 * screen needs to explain *why* (packages/notifications'
 * `explainCarryForward`). Added alongside the dashboard `approval` table
 * above rather than only in design.md's own §6.5 form — this MVP schema's
 * `approval` row is keyed by serial `id`, not `ReviewIdentity`, so
 * `originalApprovalId` references that id directly. */
export const approvalCarryForward = pgTable(
	'approval_carry_forward',
	{
		id: serial('id').primaryKey(),
		originalApprovalId: integer('original_approval_id').notNull(),
		repoId: text('repo_id').notNull(),
		prNumber: integer('pr_number').notNull(),
		scopeId: text('scope_id').notNull(),
		oldBaseSha: text('old_base_sha').notNull(),
		oldHeadSha: text('old_head_sha').notNull(),
		newBaseSha: text('new_base_sha').notNull(),
		newHeadSha: text('new_head_sha').notNull(),
		contextProofDigest: text('context_proof_digest').notNull(),
		proofAlgorithm: text('proof_algorithm').notNull(),
		carriedForwardAt: timestamp('carried_forward_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('idx_carry_forward_pr').on(t.repoId, t.prNumber)]
);
