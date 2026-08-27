import type {
	AuditEntry,
	BlockedEntry,
	CiReliabilitySummary,
	ControlApiPort,
	FeedbackCase,
	FleetOverview,
	HealthEntry,
	MyWork,
	PrDecisionDetail,
	QueueEntry,
	RecheckOutcome,
	RepoDetail,
	RepoPolicySummary,
	RepoSummary,
	ReviewerLoadSummary
} from './types';

/**
 * Mock Adapter for `ControlApiPort` (design.md 24.1節・24.2節).
 *
 * yoroi-control does not exist yet, so this returns static sample data that
 * matches the shapes yoroi-console will eventually receive over HTTP. All
 * dynamic-looking content here (PR titles, authors, SHAs) is sample data,
 * not UI copy — it intentionally does NOT go through Paraglide, unlike every
 * label/heading/status word the routes render.
 */

const repos: RepoDetail[] = [
	{
		repoId: 'r1',
		name: 'acme/payments-api',
		mode: 'serial',
		status: 'active',
		openPrs: 14,
		gatePassRatePct: 92,
		ciSuccessRatePct: 88,
		p50LeadTimeMinutes: 47,
		targetBranch: 'main',
		policyVersion: 'v12 (sha256:9f2a…)',
		rulesetConsistent: true,
		installationOk: true,
		lastWebhookAt: '2026-08-25T08:41:00Z',
		lastReconcileAt: '2026-08-25T08:40:00Z',
		metrics: {
			leadTime: { p50: 47, p95: 210 },
			reviewWait: { p50: 22, p95: 96 },
			ciDuration: { p50: 9, p95: 24 },
			queueWait: { p50: 6, p95: 31 },
			internalTime: { p50: 1, p95: 4 }
		},
		flakyRatePct: 3,
		rebuildRatePct: 5,
		batchSplitRatePct: 0,
		autoRevertRatePct: 1
	},
	{
		repoId: 'r2',
		name: 'acme/web-frontend',
		mode: 'speculative',
		status: 'active',
		openPrs: 31,
		gatePassRatePct: 85,
		ciSuccessRatePct: 79,
		p50LeadTimeMinutes: 63,
		targetBranch: 'main',
		policyVersion: 'v9 (sha256:1c7e…)',
		rulesetConsistent: true,
		installationOk: true,
		lastWebhookAt: '2026-08-25T08:39:00Z',
		lastReconcileAt: '2026-08-25T08:35:00Z',
		metrics: {
			leadTime: { p50: 63, p95: 340 },
			reviewWait: { p50: 40, p95: 180 },
			ciDuration: { p50: 14, p95: 38 },
			queueWait: { p50: 12, p95: 55 },
			internalTime: { p50: 2, p95: 6 }
		},
		flakyRatePct: 11,
		rebuildRatePct: 18,
		batchSplitRatePct: 4,
		autoRevertRatePct: 2
	},
	{
		repoId: 'r3',
		name: 'acme/infra-terraform',
		mode: 'advisory',
		status: 'paused',
		openPrs: 5,
		gatePassRatePct: 97,
		ciSuccessRatePct: 95,
		p50LeadTimeMinutes: 120,
		targetBranch: 'main',
		policyVersion: 'v4 (sha256:7ab0…)',
		rulesetConsistent: false,
		installationOk: true,
		lastWebhookAt: '2026-08-25T07:10:00Z',
		lastReconcileAt: '2026-08-25T07:05:00Z',
		metrics: {
			leadTime: { p50: 120, p95: 480 },
			reviewWait: { p50: 80, p95: 300 },
			ciDuration: { p50: 20, p95: 60 },
			queueWait: { p50: 0, p95: 0 },
			internalTime: { p50: 1, p95: 3 }
		},
		flakyRatePct: 1,
		rebuildRatePct: 0,
		batchSplitRatePct: 0,
		autoRevertRatePct: 0
	}
];

const blocked: BlockedEntry[] = [
	{
		pr: {
			repoId: 'r1',
			repo: 'acme/payments-api',
			prNumber: 421,
			title: 'Add idempotency key to charge API'
		},
		responsibility: 'other_reviewer',
		reason: 'Security Approverの承認が1件不足しています',
		nextActor: 'Security Approver',
		eta: { from: '17:40', to: '19:10', confidence: 'medium' }
	},
	{
		pr: {
			repoId: 'r2',
			repo: 'acme/web-frontend',
			prNumber: 918,
			title: 'Migrate session store to KV'
		},
		responsibility: 'ci',
		reason: 'integration-test が実行中です',
		nextActor: '—',
		eta: { from: '17:05', to: '17:25', confidence: 'high' }
	},
	{
		pr: {
			repoId: 'r2',
			repo: 'acme/web-frontend',
			prNumber: 933,
			title: 'Rebuild candidate after #918 dependency'
		},
		responsibility: 'queue',
		reason: '先行PR #918 の失敗によりcandidateを再構築中です',
		nextActor: '—',
		eta: { from: '17:30', to: '18:00', confidence: 'medium' }
	},
	{
		pr: {
			repoId: 'r1',
			repo: 'acme/payments-api',
			prNumber: 405,
			title: 'Bump webhook payload limit'
		},
		responsibility: 'your_action',
		reason: 'scope変更に伴う再承認が必要です',
		nextActor: 'あなた',
		eta: null
	},
	{
		pr: {
			repoId: 'r3',
			repo: 'acme/infra-terraform',
			prNumber: 77,
			title: 'Rotate KMS key for evidence bucket'
		},
		responsibility: 'policy_blocked',
		reason: 'repoがOperatorによりpause中です',
		nextActor: 'Operator',
		eta: null
	},
	{
		pr: {
			repoId: 'r2',
			repo: 'acme/web-frontend',
			prNumber: 940,
			title: 'Retry flaky auth-session suite'
		},
		responsibility: 'needs_investigation',
		reason: 'context safety proofがindeterminateのため安全側で失効しました',
		nextActor: 'Reviewer',
		eta: null
	}
];

const queue: QueueEntry[] = [
	{
		position: 1,
		pr: {
			repoId: 'r1',
			repo: 'acme/payments-api',
			prNumber: 398,
			title: 'Fix rounding in refund calculation'
		},
		lane: 'hotfix',
		risk: 'medium',
		agingMinutes: 8,
		candidateSha: '8f21ac3',
		runningChecks: ['unit', 'integration'],
		rebuildCount: 0,
		eta: { from: '17:05', to: '17:12', confidence: 'high' },
		rebuildNotice: null
	},
	{
		position: 2,
		pr: {
			repoId: 'r2',
			repo: 'acme/web-frontend',
			prNumber: 918,
			title: 'Migrate session store to KV'
		},
		lane: 'default',
		risk: 'medium',
		agingMinutes: 22,
		candidateSha: 'a13f902',
		runningChecks: ['integration-test'],
		rebuildCount: 1,
		eta: { from: '17:20', to: '17:40', confidence: 'medium' },
		rebuildNotice: null
	},
	{
		position: 3,
		pr: {
			repoId: 'r2',
			repo: 'acme/web-frontend',
			prNumber: 933,
			title: 'Rebuild candidate after #918 dependency'
		},
		lane: 'default',
		risk: 'low',
		agingMinutes: 19,
		candidateSha: 'c04e771',
		runningChecks: [],
		rebuildCount: 2,
		eta: { from: '17:45', to: '18:15', confidence: 'medium' },
		rebuildNotice: { causePr: 918 }
	},
	{
		position: 4,
		pr: {
			repoId: 'r1',
			repo: 'acme/payments-api',
			prNumber: 421,
			title: 'Add idempotency key to charge API'
		},
		lane: 'high_risk',
		risk: 'high',
		agingMinutes: 340,
		candidateSha: '—',
		runningChecks: [],
		rebuildCount: 0,
		eta: null,
		rebuildNotice: null
	}
];

const myWork: MyWork = {
	authored: [
		{
			pr: {
				repoId: 'r1',
				repo: 'acme/payments-api',
				prNumber: 405,
				title: 'Bump webhook payload limit'
			},
			stage: 'reviewing',
			approvalsApproved: 1,
			approvalsRequired: 2,
			ci: 'success',
			queuePosition: null,
			eta: null,
			blockingReason: 'scope変更に伴う再承認が必要です',
			nextAction: 'Security Approverへ再レビューを依頼してください',
			maintainedScopes: ['db'],
			revokedScopes: { scopes: ['auth'], reason: 'src/auth/session.ts の動作が変更されました' }
		},
		{
			pr: {
				repoId: 'r2',
				repo: 'acme/web-frontend',
				prNumber: 918,
				title: 'Migrate session store to KV'
			},
			stage: 'candidate_building',
			approvalsApproved: 2,
			approvalsRequired: 2,
			ci: 'pending',
			queuePosition: 2,
			eta: { from: '17:20', to: '17:40', confidence: 'medium' },
			blockingReason: null,
			nextAction: '対応不要です。CI完了を待っています',
			maintainedScopes: ['frontend', 'session'],
			revokedScopes: null
		}
	],
	reviewing: [
		{
			pr: {
				repoId: 'r1',
				repo: 'acme/payments-api',
				prNumber: 421,
				title: 'Add idempotency key to charge API'
			},
			scope: 'payments-core',
			reviewReason: 'payments-coreのSecurity Approverとして登録されています',
			sensitive: true,
			estimatedReviewMinutes: 25,
			waitingSince: '5時間40分前'
		},
		{
			pr: {
				repoId: 'r3',
				repo: 'acme/infra-terraform',
				prNumber: 77,
				title: 'Rotate KMS key for evidence bucket'
			},
			scope: 'infra-secrets',
			reviewReason: 'infra-secretsのInfra Approverとして登録されています',
			sensitive: true,
			estimatedReviewMinutes: 15,
			waitingSince: '1日2時間前'
		}
	]
};

const prDetails: Record<string, PrDecisionDetail> = {
	'r1/421': {
		pr: {
			repoId: 'r1',
			repo: 'acme/payments-api',
			prNumber: 421,
			title: 'Add idempotency key to charge API'
		},
		conclusion: { kind: 'waiting_approval', role: 'security_approver' },
		gates: [
			{
				gate: 'g1',
				status: 'waiting',
				reason: 'Security Approverの承認が1件不足',
				nextAction: 'Security Approverへ依頼',
				waitingOn: 'Security Approver'
			},
			{
				gate: 'g2',
				status: 'passed',
				reason: 'Candidateは最新mainと整合',
				nextAction: '—',
				waitingOn: null
			},
			{
				gate: 'g3',
				status: 'passed',
				reason: '期待checkは全て成功',
				nextAction: '—',
				waitingOn: null
			},
			{
				gate: 'g4',
				status: 'unknown',
				reason: 'G1未成立のためlease未取得',
				nextAction: '—',
				waitingOn: null
			}
		],
		approvals: [
			{
				scope: 'payments-core',
				requiredRole: 'security_approver',
				approver: null,
				maintained: false
			},
			{ scope: 'db', requiredRole: 'data_approver', approver: 'yuki-t', maintained: true }
		],
		checks: [
			{ job: 'unit', expected: true, conclusion: 'success', trustedRunner: true },
			{ job: 'integration', expected: true, conclusion: 'success', trustedRunner: true },
			{ job: 'security-scan', expected: true, conclusion: 'success', trustedRunner: true }
		],
		reasonGraph: {
			label: 'Merge不可',
			children: [
				{
					label: 'G1 Identity / Approval未成立',
					children: [{ label: 'payments-core scopeのSecurity Approver承認が0件', children: [] }]
				}
			]
		}
	},
	'r2/933': {
		pr: {
			repoId: 'r2',
			repo: 'acme/web-frontend',
			prNumber: 933,
			title: 'Rebuild candidate after #918 dependency'
		},
		conclusion: { kind: 'rebuilding' },
		gates: [
			{ gate: 'g1', status: 'passed', reason: '承認は充足済み', nextAction: '—', waitingOn: null },
			{
				gate: 'g2',
				status: 'waiting',
				reason: '先行PR #918失敗によりcandidate再構築中',
				nextAction: '—',
				waitingOn: null
			},
			{
				gate: 'g3',
				status: 'unknown',
				reason: 'candidate確定後に再評価',
				nextAction: '—',
				waitingOn: null
			},
			{ gate: 'g4', status: 'unknown', reason: 'G2未成立', nextAction: '—', waitingOn: null }
		],
		approvals: [
			{ scope: 'frontend', requiredRole: 'scope_approver', approver: 'k-sato', maintained: true }
		],
		checks: [{ job: 'unit', expected: true, conclusion: 'pending', trustedRunner: true }],
		reasonGraph: {
			label: 'Merge不可',
			children: [
				{
					label: 'G2 Candidate Integrity未成立',
					children: [
						{
							label: 'candidate再構築中',
							children: [{ label: '先行PR #918がqueueから離脱', children: [] }]
						}
					]
				}
			]
		}
	}
};

const health: HealthEntry[] = [
	{
		component: 'control',
		status: 'green',
		reason: 'outbox lag 8秒',
		updatedAt: '2026-08-25T08:41:00Z'
	},
	{
		component: 'merger',
		status: 'green',
		reason: '直近1時間のmerge 6件',
		updatedAt: '2026-08-25T08:41:00Z'
	},
	{ component: 'console', status: 'green', reason: '—', updatedAt: '2026-08-25T08:41:00Z' },
	{
		component: 'github_api',
		status: 'amber',
		reason: 'rate limit remaining 18%',
		updatedAt: '2026-08-25T08:40:00Z'
	},
	{
		component: 'evidence_export',
		status: 'green',
		reason: '直近日次検査でmissing envelopeなし',
		updatedAt: '2026-08-25T03:00:00Z'
	}
];

const auditLog: AuditEntry[] = [
	{
		occurredAt: '2026-08-25T08:12:00Z',
		actor: 'yuki-t',
		operation: 'approval',
		repo: 'acme/payments-api',
		prNumber: 405,
		result: 'db scope承認'
	},
	{
		occurredAt: '2026-08-25T07:55:00Z',
		actor: 'yoroi-merger',
		operation: 'merge',
		repo: 'acme/payments-api',
		prNumber: 398,
		result: 'merged (candidate 8f21ac3)'
	},
	{
		occurredAt: '2026-08-25T06:40:00Z',
		actor: 'ops-taro',
		operation: 'pause',
		repo: 'acme/infra-terraform',
		prNumber: null,
		result: 'reason: KMSローテーション作業中'
	}
];

const ciReliability: CiReliabilitySummary = {
	flakyTests: [
		{
			testFingerprint: 'acme/payments-api:integration/auth-session',
			repoName: 'acme/payments-api',
			ownerTeam: 'payments-platform',
			failureCount: 18,
			reproductionRatePct: 62,
			status: 'observed',
			quarantineUntil: null
		},
		{
			testFingerprint: 'acme/payments-api:unit/ledger-rounding',
			repoName: 'acme/payments-api',
			ownerTeam: 'payments-platform',
			failureCount: 6,
			reproductionRatePct: 20,
			status: 'quarantine_requested',
			quarantineUntil: '2026-08-30T01:53:46.500Z'
		},
		{
			testFingerprint: 'acme/web-frontend:e2e/checkout-flow',
			repoName: 'acme/web-frontend',
			ownerTeam: 'web-platform',
			failureCount: 4,
			reproductionRatePct: 35,
			status: 'observed',
			quarantineUntil: null
		}
	],
	candidatesBuilt: 3,
	candidatesInvalidated: 2,
	invalidationReasons: [{ reason: 'base_branch_advanced', count: 2 }]
};

const reviewerLoad: ReviewerLoadSummary = {
	byScope: [
		{ scope: 'payments-core', pendingCount: 2, reviewerCount: 2, hasBackupReviewer: true },
		{ scope: 'frontend', pendingCount: 2, reviewerCount: 1, hasBackupReviewer: false },
		{ scope: 'infra-secrets', pendingCount: 1, reviewerCount: 1, hasBackupReviewer: false }
	],
	byReviewer: [
		{ actor: 'dev-actor', pendingCount: 2, sensitiveCount: 2, oldestWaitingMinutes: 1560 },
		{ actor: 'k-sato', pendingCount: 2, sensitiveCount: 0, oldestWaitingMinutes: 120 },
		{ actor: 'yuki-t', pendingCount: 1, sensitiveCount: 1, oldestWaitingMinutes: 180 }
	],
	totalPending: 5,
	concentrationPct: 40,
	carryForwardRatePct: 17
};

const policySummaries: RepoPolicySummary[] = [
	{
		repoId: 'r1',
		repoName: 'acme/payments-api',
		policyDigest: 'v13-payments-override (sha256:44f1a9…)',
		source: 'published_bundle',
		version: 'v13',
		publishedAt: '2026-08-13T01:53:46.500Z',
		openPrCount: 3
	},
	{
		repoId: 'r2',
		repoName: 'acme/web-frontend',
		policyDigest: '8f6ce0778834c1377cc0c0b769d462efaa2bcb6bfea6f3db678ca7a57a99c871',
		source: 'default_fallback',
		version: null,
		publishedAt: null,
		openPrCount: 3
	},
	{
		repoId: 'r3',
		repoName: 'acme/infra-terraform',
		policyDigest: '8f6ce0778834c1377cc0c0b769d462efaa2bcb6bfea6f3db678ca7a57a99c871',
		source: 'default_fallback',
		version: null,
		publishedAt: null,
		openPrCount: 1
	}
];

export function createMockControlApi(): ControlApiPort {
	return {
		async getFleetOverview(): Promise<FleetOverview> {
			return {
				organizations: 1,
				repositories: repos.length,
				openPrs: repos.reduce((sum, r) => sum + r.openPrs, 0),
				queued: queue.length,
				gatePassed: 12,
				blocked: blocked.length,
				highRisk: queue.filter((q) => q.risk === 'high').length,
				longStalled: queue.filter((q) => q.agingMinutes > 180).length,
				ciFailingRepos: 1,
				rateLimitRemainingPct: 18,
				blockedByResponsibility: (
					[
						'your_action',
						'other_reviewer',
						'ci',
						'queue',
						'yoroi_internal',
						'github_outage',
						'policy_blocked',
						'needs_investigation'
					] as const
				).map((r) => ({
					responsibility: r,
					count: blocked.filter((b) => b.responsibility === r).length
				})),
				recent: { merged: 9, failed: 2, autoReverted: 0 }
			};
		},
		async getBlockedEntries(): Promise<BlockedEntry[]> {
			return blocked;
		},
		async getMyWork(): Promise<MyWork> {
			return myWork;
		},
		async listRepos(): Promise<RepoSummary[]> {
			return repos.map(
				({
					repoId,
					name,
					mode,
					status,
					openPrs,
					gatePassRatePct,
					ciSuccessRatePct,
					p50LeadTimeMinutes
				}) => ({
					repoId,
					name,
					mode,
					status,
					openPrs,
					gatePassRatePct,
					ciSuccessRatePct,
					p50LeadTimeMinutes
				})
			);
		},
		async getRepoDetail(repoId: string): Promise<RepoDetail | null> {
			return repos.find((r) => r.repoId === repoId) ?? null;
		},
		async getMergeQueue(): Promise<QueueEntry[]> {
			return queue;
		},
		async getPrDecisionDetail(repoId: string, prNumber: number): Promise<PrDecisionDetail | null> {
			return prDetails[`${repoId}/${prNumber}`] ?? null;
		},
		async getHealth(): Promise<HealthEntry[]> {
			return health;
		},
		async searchAudit(query: string): Promise<AuditEntry[]> {
			const q = query.trim().toLowerCase();
			if (!q) return auditLog;
			return auditLog.filter((e) =>
				[e.actor, e.operation, e.repo, e.result, String(e.prNumber ?? '')].some((field) =>
					field.toLowerCase().includes(q)
				)
			);
		},
		/** yoroi-controlが無いため、常に「変化なし」を返す固定応答にとどめる。 */
		async recheckPr(): Promise<RecheckOutcome> {
			return 'unchanged';
		},
		async submitFeedback(
			repoId: string,
			prNumber: number,
			description: string
		): Promise<FeedbackCase> {
			return {
				id: 0,
				repoId,
				prNumber,
				category: 'console',
				actorStableId: 'mock-actor',
				description,
				createdAt: new Date().toISOString()
			};
		},
		async getCiReliability(): Promise<CiReliabilitySummary> {
			return ciReliability;
		},
		async getReviewerLoad(): Promise<ReviewerLoadSummary> {
			return reviewerLoad;
		},
		async getPolicySummaries(): Promise<RepoPolicySummary[]> {
			return policySummaries;
		}
	};
}

/** 24.1節: シングルトンとして公開し、`+page.server.ts`はこの参照だけに依存する。 */
export const controlApi: ControlApiPort = createMockControlApi();
