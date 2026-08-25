/**
 * Read-model shapes yoroi-control serves over HTTP. These deliberately
 * mirror `src/lib/server/yoroi/types.ts` in the console app rather than
 * being imported across apps: the HTTP boundary between yoroi-console and
 * yoroi-control is the real contract (design.md 1.5節 Ports at the Edges),
 * and the two apps run on different toolchains (Deno vs. the root app's
 * npm/SvelteKit). Keep the two files in sync by hand when either changes.
 */

export type Stage =
	| "discovered"
	| "draft"
	| "reviewing"
	| "approval_covered"
	| "prechecked"
	| "queued"
	| "candidate_building"
	| "gate_passed"
	| "merging"
	| "merged"
	| "observing"
	| "superseded"
	| "paused"
	| "quarantined"
	| "reverting";

export type Responsibility =
	| "your_action"
	| "other_reviewer"
	| "ci"
	| "queue"
	| "yoroi_internal"
	| "github_outage"
	| "policy_blocked"
	| "needs_investigation";

export type EtaConfidence = "low" | "medium" | "high";

export interface Eta {
	from: string;
	to: string;
	confidence: EtaConfidence;
}

export type HealthStatus = "green" | "amber" | "red";
export type HealthComponent = "control" | "merger" | "console" | "github_api" | "evidence_export";
export type QueueMode = "observe" | "advisory" | "serial" | "speculative" | "batch";
export type RepoStatus = "active" | "paused" | "draining";
export type Lane = "default" | "hotfix" | "high_risk" | "mega";
export type Risk = "low" | "medium" | "high";
export type GateStatus = "passed" | "waiting" | "failed" | "unknown";
export type CheckConclusion = "success" | "failure" | "cancelled" | "pending";

export type Role =
	| "reviewer"
	| "scope_approver"
	| "security_approver"
	| "data_approver"
	| "infra_approver"
	| "governor"
	| "operator"
	| "maintainer"
	| "developer";

export interface PrRef {
	repoId: string;
	repo: string;
	prNumber: number;
	title: string;
}

export interface BlockedEntry {
	pr: PrRef;
	responsibility: Responsibility;
	reason: string;
	nextActor: string;
	eta: Eta | null;
}

export interface FleetOverview {
	organizations: number;
	repositories: number;
	openPrs: number;
	queued: number;
	gatePassed: number;
	blocked: number;
	highRisk: number;
	longStalled: number;
	ciFailingRepos: number;
	rateLimitRemainingPct: number;
	blockedByResponsibility: Array<{ responsibility: Responsibility; count: number }>;
	recent: { merged: number; failed: number; autoReverted: number };
}

export interface MyWorkAuthoredItem {
	pr: PrRef;
	stage: Stage;
	approvalsApproved: number;
	approvalsRequired: number;
	ci: CheckConclusion;
	queuePosition: number | null;
	eta: Eta | null;
	blockingReason: string | null;
	nextAction: string;
	maintainedScopes: string[];
	revokedScopes: { scopes: string[]; reason: string } | null;
}

export interface MyWorkReviewItem {
	pr: PrRef;
	scope: string;
	reviewReason: string;
	sensitive: boolean;
	estimatedReviewMinutes: number;
	waitingSince: string;
}

export interface MyWork {
	authored: MyWorkAuthoredItem[];
	reviewing: MyWorkReviewItem[];
}

export interface RepoSummary {
	repoId: string;
	name: string;
	mode: QueueMode;
	status: RepoStatus;
	openPrs: number;
	gatePassRatePct: number;
	ciSuccessRatePct: number;
	p50LeadTimeMinutes: number;
}

export interface RepoMetrics {
	leadTime: { p50: number; p95: number };
	reviewWait: { p50: number; p95: number };
	ciDuration: { p50: number; p95: number };
	queueWait: { p50: number; p95: number };
	internalTime: { p50: number; p95: number };
}

export interface RepoDetail extends RepoSummary {
	targetBranch: string;
	policyVersion: string;
	rulesetConsistent: boolean;
	installationOk: boolean;
	lastWebhookAt: string;
	lastReconcileAt: string;
	metrics: RepoMetrics;
	flakyRatePct: number;
	rebuildRatePct: number;
	batchSplitRatePct: number;
	autoRevertRatePct: number;
}

export interface QueueEntry {
	position: number;
	pr: PrRef;
	lane: Lane;
	risk: Risk;
	agingMinutes: number;
	candidateSha: string;
	runningChecks: string[];
	rebuildCount: number;
	eta: Eta | null;
	rebuildNotice: { causePr: number } | null;
}

export interface GateRow {
	gate: "g1" | "g2" | "g3" | "g4";
	status: GateStatus;
	reason: string;
	nextAction: string;
	waitingOn: string | null;
}

export interface ApprovalRow {
	scope: string;
	requiredRole: Role;
	approver: string | null;
	maintained: boolean;
}

export interface CheckRow {
	job: string;
	expected: boolean;
	conclusion: CheckConclusion | null;
	trustedRunner: boolean;
}

export interface ReasonGraphNode {
	label: string;
	children: ReasonGraphNode[];
}

export type PrConclusion =
	| { kind: "mergeable" }
	| { kind: "waiting_ci" }
	| { kind: "waiting_approval"; role: Role }
	| { kind: "rebuilding" }
	| { kind: "policy_violation" }
	| { kind: "fail_closed" };

export interface PrDecisionDetail {
	pr: PrRef;
	conclusion: PrConclusion;
	gates: GateRow[];
	approvals: ApprovalRow[];
	checks: CheckRow[];
	reasonGraph: ReasonGraphNode;
}

export interface HealthEntry {
	component: HealthComponent;
	status: HealthStatus;
	reason: string;
	updatedAt: string;
}

export interface AuditEntry {
	occurredAt: string;
	actor: string;
	operation: string;
	repo: string;
	prNumber: number | null;
	result: string;
}

export type RecheckOutcome = "unchanged" | "changed" | "pending";

export interface FeedbackCase {
	id: number;
	repoId: string;
	prNumber: number | null;
	category: string;
	actorStableId: string;
	description: string;
	createdAt: string;
}
