import { assertEquals } from "@std/assert";
import { approverRoleToDashboardRole, dashboardRoleToApproverRole } from "./role-mapping.ts";
import type { ApproverRole } from "@yoroi/domain";
import type { Role } from "../domain/types.ts";

const ALL_APPROVER_ROLES: readonly ApproverRole[] = [
	"reviewer",
	"scope-approver",
	"security-approver",
	"data-approver",
	"infra-approver",
	"org-governor",
];

Deno.test("approverRoleToDashboardRole: 全てのApproverRoleがDashboard語彙へ写像できる", () => {
	for (const role of ALL_APPROVER_ROLES) {
		const mapped = approverRoleToDashboardRole(role);
		assertEquals(typeof mapped, "string");
	}
});

Deno.test("approverRoleToDashboardRole: ハイフン区切りをアンダースコア区切りへ変換する", () => {
	assertEquals(approverRoleToDashboardRole("scope-approver"), "scope_approver");
	assertEquals(approverRoleToDashboardRole("security-approver"), "security_approver");
});

Deno.test("approverRoleToDashboardRole: org-governorはgovernorへ写像される（語彙自体が異なる）", () => {
	assertEquals(approverRoleToDashboardRole("org-governor"), "governor");
});

Deno.test("dashboardRoleToApproverRole: 往復変換で元に戻る（policy語彙6件について）", () => {
	for (const role of ALL_APPROVER_ROLES) {
		const dashboardRole = approverRoleToDashboardRole(role);
		assertEquals(dashboardRoleToApproverRole(dashboardRole), role);
	}
});

Deno.test("dashboardRoleToApproverRole: operator/maintainer/developerはnull（policy承認roleではない）", () => {
	for (const role of ["operator", "maintainer", "developer"] as const satisfies readonly Role[]) {
		assertEquals(dashboardRoleToApproverRole(role), null);
	}
});
