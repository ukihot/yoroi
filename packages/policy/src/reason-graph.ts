import type { ApproverRole, ScopeId } from '@yoroi/domain';

/** design.md §9.3/§14.2's ReasonGraphNode — also the shape yoroi-console's
 * PR detail screen renders directly (design.md §23.8). */
export interface ReasonGraphNode {
	readonly label: string;
	readonly children: readonly ReasonGraphNode[];
}

export interface ApprovalEvaluation {
	readonly pass: boolean;
	readonly missing: readonly {
		readonly scopeId: ScopeId;
		readonly role: ApproverRole;
		readonly have: number;
		readonly need: number;
	}[];
}

export interface CheckEvaluation {
	readonly pass: boolean;
	readonly pending: boolean;
	readonly failedJobs: readonly string[];
	readonly pendingJobs: readonly string[];
}

export interface QueueEvaluation {
	readonly pass: boolean;
	readonly reason: string | null;
}

export function buildReasonGraph(parts: {
	readonly approvalResult: ApprovalEvaluation;
	readonly checkResult: CheckEvaluation;
	readonly queueResult: QueueEvaluation;
}): ReasonGraphNode {
	const children: ReasonGraphNode[] = [];

	if (!parts.approvalResult.pass) {
		children.push({
			label: 'G1 Identity / Approval未成立',
			children: parts.approvalResult.missing.map((m) => ({
				label: `${m.scopeId} scopeの${m.role}承認が${m.need - m.have}件不足`,
				children: []
			}))
		});
	}

	if (!parts.checkResult.pass) {
		children.push({
			label: 'G3 Test Evidence未成立',
			children: [
				...parts.checkResult.failedJobs.map((j) => ({ label: `${j}が失敗`, children: [] })),
				...parts.checkResult.pendingJobs.map((j) => ({ label: `${j}実行中`, children: [] }))
			]
		});
	}

	if (!parts.queueResult.pass && parts.queueResult.reason) {
		children.push({ label: parts.queueResult.reason, children: [] });
	}

	return { label: children.length === 0 ? 'Merge可能' : 'Merge不可', children };
}
