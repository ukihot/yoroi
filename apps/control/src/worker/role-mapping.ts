import type { ApproverRole } from "@yoroi/domain";
import type { Role } from "../domain/types.ts";

/**
 * Two role vocabularies exist in this codebase and are NOT the same set:
 *  - `@yoroi/domain`'s `ApproverRole` (design.md §9.1's policy YAML
 *    vocabulary — hyphenated, 6 values, approval-only).
 *  - `apps/control/src/domain/types.ts`'s `Role` (the dashboard/HTTP
 *    read-model vocabulary — underscored, 9 values, includes operational
 *    roles like operator/maintainer/developer that never appear in a
 *    policy's `approvals[].role`).
 * `packages/postgres/src/schema.ts`'s dashboard tables store the *second*
 * vocabulary (their own inline `DashboardRole` literal union mirrors `Role`
 * exactly). Anything moving a role value from policy evaluation into a
 * dashboard-table column — or back out — must go through one of these two
 * functions; never cast between them directly.
 */
const APPROVER_ROLE_TO_DASHBOARD_ROLE: Readonly<Record<ApproverRole, Role>> = {
	"reviewer": "reviewer",
	"scope-approver": "scope_approver",
	"security-approver": "security_approver",
	"data-approver": "data_approver",
	"infra-approver": "infra_approver",
	"org-governor": "governor",
};

const DASHBOARD_ROLE_TO_APPROVER_ROLE: Readonly<Partial<Record<Role, ApproverRole>>> = {
	"reviewer": "reviewer",
	"scope_approver": "scope-approver",
	"security_approver": "security-approver",
	"data_approver": "data-approver",
	"infra_approver": "infra-approver",
	"governor": "org-governor",
};

export function approverRoleToDashboardRole(role: ApproverRole): Role {
	return APPROVER_ROLE_TO_DASHBOARD_ROLE[role];
}

/** `operator`/`maintainer`/`developer` have no `ApproverRole` counterpart —
 * an `approval` row can't legitimately hold one of those (nothing in policy
 * evaluation would have written it), so this returns `null` rather than
 * silently mapping to an arbitrary approval role; callers should treat a
 * `null` as "this row doesn't participate in approval-coverage matching". */
export function dashboardRoleToApproverRole(role: Role): ApproverRole | null {
	return DASHBOARD_ROLE_TO_APPROVER_ROLE[role] ?? null;
}
