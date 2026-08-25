/**
 * Central enum → Paraglide message mapping (design.md 14.2節 の翻訳規約と同じ考え方).
 *
 * Every screen renders these labels through here instead of switching on the
 * enum value inline, so no UI string literal has to be typed twice — and
 * `messages/ja.json` / `messages/en.json` stay the single source of truth for
 * every word a viewer sees (this file only chooses *which* message).
 */
import * as m from '$lib/paraglide/messages';
import type {
	CheckConclusion,
	EtaConfidence,
	GateStatus,
	HealthComponent,
	HealthStatus,
	Lane,
	PrConclusion,
	QueueMode,
	RepoStatus,
	Responsibility,
	Risk,
	Role,
	Stage
} from '$lib/server/yoroi/types';

export function stageLabel(stage: Stage): string {
	return (
		{
			discovered: m.stage_discovered,
			draft: m.stage_draft,
			reviewing: m.stage_reviewing,
			approval_covered: m.stage_approval_covered,
			prechecked: m.stage_prechecked,
			queued: m.stage_queued,
			candidate_building: m.stage_candidate_building,
			gate_passed: m.stage_gate_passed,
			merging: m.stage_merging,
			merged: m.stage_merged,
			observing: m.stage_observing,
			superseded: m.stage_superseded,
			paused: m.stage_paused,
			quarantined: m.stage_quarantined,
			reverting: m.stage_reverting
		}[stage]()
	);
}

export function responsibilityLabel(responsibility: Responsibility): string {
	return (
		{
			your_action: m.responsibility_your_action,
			other_reviewer: m.responsibility_other_reviewer,
			ci: m.responsibility_ci,
			queue: m.responsibility_queue,
			yoroi_internal: m.responsibility_yoroi_internal,
			github_outage: m.responsibility_github_outage,
			policy_blocked: m.responsibility_policy_blocked,
			needs_investigation: m.responsibility_needs_investigation
		}[responsibility]()
	);
}

export function etaConfidenceLabel(confidence: EtaConfidence): string {
	return (
		{ low: m.eta_confidence_low, medium: m.eta_confidence_medium, high: m.eta_confidence_high }[confidence]()
	);
}

export function healthStatusLabel(status: HealthStatus): string {
	return { green: m.health_status_green, amber: m.health_status_amber, red: m.health_status_red }[status]();
}

export function healthComponentLabel(component: HealthComponent): string {
	return (
		{
			control: m.health_component_control,
			merger: m.health_component_merger,
			console: m.health_component_console,
			github_api: m.health_component_github_api,
			evidence_export: m.health_component_evidence_export
		}[component]()
	);
}

export function roleLabel(role: Role): string {
	return (
		{
			reviewer: m.role_reviewer,
			scope_approver: m.role_scope_approver,
			security_approver: m.role_security_approver,
			data_approver: m.role_data_approver,
			infra_approver: m.role_infra_approver,
			governor: m.role_governor,
			operator: m.role_operator,
			maintainer: m.role_maintainer,
			developer: m.role_developer
		}[role]()
	);
}

export function queueModeLabel(mode: QueueMode): string {
	return (
		{
			observe: m.mode_observe,
			advisory: m.mode_advisory,
			serial: m.mode_serial,
			speculative: m.mode_speculative,
			batch: m.mode_batch
		}[mode]()
	);
}

export function repoStatusLabel(status: RepoStatus): string {
	return (
		{ active: m.repostatus_active, paused: m.repostatus_paused, draining: m.repostatus_draining }[status]()
	);
}

export function laneLabel(lane: Lane): string {
	return (
		{
			default: m.queue_lane_default,
			hotfix: m.queue_lane_hotfix,
			high_risk: m.queue_lane_high_risk,
			mega: m.queue_lane_mega
		}[lane]()
	);
}

export function riskLabel(risk: Risk): string {
	return { low: m.queue_risk_low, medium: m.queue_risk_medium, high: m.queue_risk_high }[risk]();
}

export function gateStatusLabel(status: GateStatus): string {
	return (
		{
			passed: m.gate_status_passed,
			waiting: m.gate_status_waiting,
			failed: m.gate_status_failed,
			unknown: m.gate_status_unknown
		}[status]()
	);
}

export function checkConclusionLabel(conclusion: CheckConclusion): string {
	return (
		{
			success: m.check_conclusion_success,
			failure: m.check_conclusion_failure,
			cancelled: m.check_conclusion_cancelled,
			pending: m.check_conclusion_pending
		}[conclusion]()
	);
}

export function gateName(gate: 'g1' | 'g2' | 'g3' | 'g4'): string {
	return (
		{ g1: m.prdetail_gate_g1, g2: m.prdetail_gate_g2, g3: m.prdetail_gate_g3, g4: m.prdetail_gate_g4 }[gate]()
	);
}

export type Tone = 'green' | 'amber' | 'red' | 'neutral';

/** design.md 23.2節: 誰の責任領域で止まっているかを一目で判別できる色分け。 */
export function responsibilityTone(responsibility: Responsibility): Tone {
	switch (responsibility) {
		case 'your_action':
		case 'needs_investigation':
			return 'red';
		case 'policy_blocked':
		case 'github_outage':
			return 'amber';
		default:
			return 'neutral';
	}
}

export function gateStatusTone(status: GateStatus): Tone {
	return { passed: 'green', waiting: 'amber', failed: 'red', unknown: 'neutral' }[status] as Tone;
}

export function checkConclusionTone(conclusion: CheckConclusion): Tone {
	return { success: 'green', failure: 'red', cancelled: 'neutral', pending: 'amber' }[conclusion] as Tone;
}

export function riskTone(risk: Risk): Tone {
	return { low: 'green', medium: 'amber', high: 'red' }[risk] as Tone;
}

export function conclusionLabel(conclusion: PrConclusion): string {
	switch (conclusion.kind) {
		case 'mergeable':
			return m.prdetail_conclusion_mergeable();
		case 'waiting_ci':
			return m.prdetail_conclusion_waiting_ci();
		case 'waiting_approval':
			return m.prdetail_conclusion_waiting_approval({ role: roleLabel(conclusion.role) });
		case 'rebuilding':
			return m.prdetail_conclusion_rebuilding();
		case 'policy_violation':
			return m.prdetail_conclusion_policy_violation();
		case 'fail_closed':
			return m.prdetail_conclusion_fail_closed();
	}
}

export function conclusionTone(conclusion: PrConclusion): Tone {
	switch (conclusion.kind) {
		case 'mergeable':
			return 'green';
		case 'policy_violation':
		case 'fail_closed':
			return 'red';
		default:
			return 'amber';
	}
}
