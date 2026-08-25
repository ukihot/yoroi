import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import type {
	CheckRow,
	Eta,
	GateRow,
	HealthComponent,
	HealthStatus,
	Lane,
	PrConclusion,
	QueueMode,
	ReasonGraphNode,
	RepoMetrics,
	RepoStatus,
	Responsibility,
	Risk,
	Role,
	Stage,
} from "../domain/types.ts";

/**
 * Drizzle schema for yoroi-control's own PostgreSQL database. This database
 * is private to yoroi-control; yoroi-console never connects to it directly
 * (design.md §2.2) — it has its own, unrelated database for Better Auth
 * (`src/lib/server/db` in the console app).
 *
 * Tables are taken near-verbatim from design.md where they map directly onto
 * a section (noted per table below), plus pragmatic MVP additions where the
 * design doc defers the real mechanism to a later phase (ownership graph,
 * Policy Engine, CI evidence ingestion — see doc/design.md §21). Those
 * additions are called out in comments rather than silently invented.
 *
 * No cross-table foreign keys are declared for the repoId/prNumber pairs
 * used throughout: pull_request_revision's primary key is the composite
 * (repo_id, pr_number), and wiring every child table to it would need
 * table-level composite FKs for no real integrity benefit at this stage.
 * Left to application code for MVP.
 */

export const repository = pgTable("repository", {
	repoId: text("repo_id").primaryKey(),
	installationId: bigint("installation_id", { mode: "number" }).notNull(),
	name: text("name").notNull(),
	mode: text("mode").notNull().$type<QueueMode>(),
	status: text("status").notNull().$type<RepoStatus>(),
	targetBranch: text("target_branch").notNull().default("main"),
	policyVersion: text("policy_version").notNull().default(""),
	rulesetConsistent: boolean("ruleset_consistent").notNull().default(true),
	installationOk: boolean("installation_ok").notNull().default(true),
	lastWebhookAt: timestamp("last_webhook_at", { withTimezone: true }),
	lastReconcileAt: timestamp("last_reconcile_at", { withTimezone: true }),
	openPrs: integer("open_prs").notNull().default(0),
	gatePassRatePct: integer("gate_pass_rate_pct").notNull().default(0),
	ciSuccessRatePct: integer("ci_success_rate_pct").notNull().default(0),
	p50LeadTimeMinutes: integer("p50_lead_time_minutes").notNull().default(0),
	flakyRatePct: integer("flaky_rate_pct").notNull().default(0),
	rebuildRatePct: integer("rebuild_rate_pct").notNull().default(0),
	batchSplitRatePct: integer("batch_split_rate_pct").notNull().default(0),
	autoRevertRatePct: integer("auto_revert_rate_pct").notNull().default(0),
	// { leadTime, reviewWait, ciDuration, queueWait, internalTime }, each { p50, p95 } (design.md §23.6)
	metrics: jsonb("metrics").notNull().$type<RepoMetrics>(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const pullRequestRevision = pgTable(
	"pull_request_revision",
	{
		// design.md §6.5 base, + title (needed for PrRef, not in the original DDL)
		// + next_action / revoked_scopes* (needed for MyWork; §23.5 describes the
		// content but not a storage shape — a real Policy Engine would derive
		// these, not store them, once §9 exists).
		repoId: text("repo_id").notNull(),
		prNumber: integer("pr_number").notNull(),
		title: text("title").notNull().default(""),
		headSha: text("head_sha").notNull(),
		baseSha: text("base_sha").notNull(),
		isDraft: boolean("is_draft").notNull().default(false),
		authorStableId: text("author_stable_id").notNull(),
		state: text("state").notNull().$type<Stage>(),
		stateVersion: integer("state_version").notNull().default(0),
		nextAction: text("next_action").notNull().default(""),
		revokedScopes: text("revoked_scopes").array(),
		revokedScopesReason: text("revoked_scopes_reason"),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(
		t,
	) => [
		primaryKey({ columns: [t.repoId, t.prNumber] }),
		index("idx_pr_revision_author").on(t.authorStableId),
	],
);

export const approval = pgTable(
	"approval",
	{
		// design.md §6.5, adapted to the text repo_id used throughout this schema.
		// `maintained` replaces the real scope-change-digest comparison (§8) we're
		// not implementing yet.
		id: serial("id").primaryKey(),
		repoId: text("repo_id").notNull(),
		prNumber: integer("pr_number").notNull(),
		scopeId: text("scope_id").notNull(),
		actorStableId: text("actor_stable_id").notNull(),
		role: text("role").notNull().$type<Role>(),
		maintained: boolean("maintained").notNull().default(true),
		approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		revokeReason: text("revoke_reason"),
	},
	(t) => [index("idx_approval_pr").on(t.repoId, t.prNumber)],
);

/** New: which scopes/roles a PR requires approval from. Design.md's Policy
 * Engine (§9) would compute this from policy + touched scopes; here it's
 * simply stored per PR. */
export const prScopeRequirement = pgTable(
	"pr_scope_requirement",
	{
		id: serial("id").primaryKey(),
		repoId: text("repo_id").notNull(),
		prNumber: integer("pr_number").notNull(),
		scopeId: text("scope_id").notNull(),
		requiredRole: text("required_role").notNull().$type<Role>(),
	},
	(t) => [index("idx_scope_requirement_pr").on(t.repoId, t.prNumber)],
);

export const queueEntry = pgTable(
	"queue_entry",
	{
		// design.md §6.6 base (lane, priority, enqueued_at, eta_*, state) + MVP
		// columns the console's Merge Queue screen needs (risk, candidate_sha,
		// running_checks, rebuild_count, rebuild_notice). No stored `position`:
		// computed at query time by ordering, same as design's own approach.
		id: serial("id").primaryKey(),
		repoId: text("repo_id").notNull(),
		prNumber: integer("pr_number").notNull(),
		lane: text("lane").notNull().$type<Lane>().default("default"),
		risk: text("risk").notNull().$type<Risk>().default("medium"),
		priority: integer("priority").notNull().default(0),
		enqueuedAt: timestamp("enqueued_at", { withTimezone: true }).notNull().defaultNow(),
		candidateSha: text("candidate_sha").notNull().default("—"),
		runningChecks: text("running_checks").array(),
		rebuildCount: integer("rebuild_count").notNull().default(0),
		rebuildNoticeCausePr: integer("rebuild_notice_cause_pr"),
		etaFrom: timestamp("eta_from", { withTimezone: true }),
		etaTo: timestamp("eta_to", { withTimezone: true }),
		etaConfidence: text("eta_confidence").$type<Eta["confidence"]>(),
		state: text("state").notNull().default("waiting"),
	},
	(t) => [index("idx_queue_order").on(t.priority, t.enqueuedAt)],
);

/**
 * New: folds design.md §5 (state machine) / §9 (Policy Engine) / §14 (reason
 * graph) *output* into one row per PR, since no real evaluator produces this
 * data yet — see doc/design.md §21 Phase 1-3. `all_gates_passed` /
 * `has_ci_failure` are denormalized so fleet-wide counts (FleetOverview) are
 * cheap instead of scanning the `gates`/`checks` JSON.
 *
 * design.md §6.6's `merge_candidate` / `expected_check_plan` / `check_evidence`
 * are intentionally not modeled as separate relational tables for MVP —
 * there's no CI evidence ingestion pipeline (§13) to populate them
 * incrementally yet, so `checks` lives as JSON here instead. Switch to the
 * relational form once that pipeline exists.
 */
export const prDecisionSnapshot = pgTable(
	"pr_decision_snapshot",
	{
		repoId: text("repo_id").notNull(),
		prNumber: integer("pr_number").notNull(),
		conclusion: jsonb("conclusion").notNull().$type<PrConclusion>(),
		gates: jsonb("gates").notNull().$type<GateRow[]>(),
		checks: jsonb("checks").notNull().$type<CheckRow[]>(),
		reasonGraph: jsonb("reason_graph").notNull().$type<ReasonGraphNode>(),
		allGatesPassed: boolean("all_gates_passed").notNull().default(false),
		hasCiFailure: boolean("has_ci_failure").notNull().default(false),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.repoId, t.prNumber] })],
);

/** New: stands in for the "ownership graph" design.md defers to a later
 * phase (§23.10 mentions it as a concept without a storage design). Backs
 * MyWork's "reviewing" section. */
export const prReviewerAssignment = pgTable(
	"pr_reviewer_assignment",
	{
		id: serial("id").primaryKey(),
		repoId: text("repo_id").notNull(),
		prNumber: integer("pr_number").notNull(),
		scopeId: text("scope_id").notNull(),
		actorStableId: text("actor_stable_id").notNull(),
		reason: text("reason").notNull().default(""),
		sensitive: boolean("sensitive").notNull().default(false),
		estimatedReviewMinutes: integer("estimated_review_minutes").notNull().default(0),
		waitingSince: timestamp("waiting_since", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("idx_reviewer_assignment_actor").on(t.actorStableId)],
);

/** New: backs getBlockedEntries() directly and several FleetOverview
 * aggregates (design.md §23.2 BlockedResponsibility, §23.4 Home). */
export const blockedEntry = pgTable(
	"blocked_entry",
	{
		id: serial("id").primaryKey(),
		repoId: text("repo_id").notNull(),
		prNumber: integer("pr_number").notNull(),
		responsibility: text("responsibility").notNull().$type<Responsibility>(),
		reason: text("reason").notNull(),
		nextActor: text("next_actor").notNull(),
		etaFrom: timestamp("eta_from", { withTimezone: true }),
		etaTo: timestamp("eta_to", { withTimezone: true }),
		etaConfidence: text("eta_confidence").$type<Eta["confidence"]>(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("idx_blocked_responsibility").on(t.responsibility)],
);

/** design.md §6.7, close to verbatim. */
export const feedbackCase = pgTable("feedback_case", {
	id: serial("id").primaryKey(),
	repoId: text("repo_id").notNull(),
	prNumber: integer("pr_number"),
	category: text("category").notNull(),
	actorStableId: text("actor_stable_id").notNull(),
	description: text("description").notNull().default(""),
	disposition: text("disposition"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

/**
 * design.md §6.7 + `operation`/`result` columns (MVP additions, needed for
 * AuditEntry — not in the original minimal DDL). Append-only in application
 * code: design.md enforces that at the DB-role level with
 * `REVOKE UPDATE, DELETE`, which isn't set up for this MVP database (single
 * app role) — tracked as follow-up hardening once real evidence/audit
 * (§8, §12) exists. Hash-chain columns (`prev_hash`/`row_hash`) are likewise
 * deferred to that follow-up.
 */
export const decisionEvent = pgTable(
	"decision_event",
	{
		seq: serial("seq").primaryKey(),
		repoId: text("repo_id").notNull(),
		prNumber: integer("pr_number"),
		actorStableId: text("actor_stable_id"),
		operation: text("operation").notNull(),
		fromState: text("from_state"),
		toState: text("to_state"),
		reasonCode: text("reason_code").notNull().default(""),
		result: text("result").notNull().default(""),
		evidence: jsonb("evidence").notNull().$defaultFn(() => ({})),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("idx_decision_event_occurred").on(t.occurredAt)],
);

/** design.md §24.7, verbatim. */
export const fleetHealthSnapshot = pgTable(
	"fleet_health_snapshot",
	{
		installationId: bigint("installation_id", { mode: "number" }).notNull(),
		component: text("component").notNull().$type<HealthComponent>(),
		status: text("status").notNull().$type<HealthStatus>(),
		metric: jsonb("metric").notNull().$defaultFn(() => ({})),
		reason: text("reason"),
		observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.installationId, t.component] })],
);
