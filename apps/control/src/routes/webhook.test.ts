import { assertEquals } from "@std/assert";
import { EVENT_ALLOWLIST, minimalEventFacts, routeEventToWorkKind } from "./webhook.ts";
import type { MinimalEventFacts } from "../worker/event-facts.ts";

/**
 * Only the pure extraction/routing helpers are covered here — `handleWebhook`
 * itself reaches a real Postgres connection via `getControlContext()`
 * (`insertInboxAndOutbox`, `drainOutbox`), matching this repo's existing
 * convention (see src/app.test.ts's top comment) of not unit-testing
 * DB-touching handlers; that path is covered by `deno check` + manual
 * verification against a real database once one exists.
 */

Deno.test("EVENT_ALLOWLIST: 主要なGitHub webhook eventを許可する", () => {
	for (
		const event of ["pull_request", "pull_request_review", "issue_comment", "check_run", "push"]
	) {
		assertEquals(EVENT_ALLOWLIST.has(event), true);
	}
});

Deno.test("EVENT_ALLOWLIST: 未知eventは許可しない", () => {
	assertEquals(EVENT_ALLOWLIST.has("marketplace_purchase"), false);
});

Deno.test("routeEventToWorkKind: issue_commentはslash command処理へ", () => {
	assertEquals(routeEventToWorkKind("issue_comment"), "handle_slash_command");
});

Deno.test("routeEventToWorkKind: pull_request/pull_request_reviewはpolicy評価へ", () => {
	assertEquals(routeEventToWorkKind("pull_request"), "evaluate_policy");
	assertEquals(routeEventToWorkKind("pull_request_review"), "evaluate_policy");
});

Deno.test("routeEventToWorkKind: check_run/check_suite/statusはcheck結果取り込みへ (P-05)", () => {
	assertEquals(routeEventToWorkKind("check_run"), "ingest_check_result");
	assertEquals(routeEventToWorkKind("check_suite"), "ingest_check_result");
	assertEquals(routeEventToWorkKind("status"), "ingest_check_result");
});

Deno.test("routeEventToWorkKind: それ以外はreconcile hintへfallback", () => {
	assertEquals(routeEventToWorkKind("installation"), "reconcile_hint");
	assertEquals(routeEventToWorkKind("push"), "reconcile_hint");
});

Deno.test("minimalEventFacts: pull_requestからrepo/PR番号/actionを抽出する (FR-002: 最小限のfacts)", () => {
	const facts = minimalEventFacts("pull_request", {
		action: "synchronize",
		repository: { id: 1, full_name: "acme/widgets" },
		pull_request: { number: 42 },
	}) as MinimalEventFacts;
	assertEquals(facts.repoFullName, "acme/widgets");
	assertEquals(facts.pullRequestNumber, 42);
	assertEquals(facts.action, "synchronize");
	assertEquals(facts.isIssueComment, false);
});

Deno.test("minimalEventFacts: issue_commentからcomment本文とactorを抽出する", () => {
	const facts = minimalEventFacts("issue_comment", {
		action: "created",
		repository: { id: 1, full_name: "acme/widgets" },
		issue: { number: 7 },
		comment: { body: "/yoroi status", user: { node_id: "U_actor1" } },
	}) as MinimalEventFacts;
	assertEquals(facts.pullRequestNumber, 7);
	assertEquals(facts.isIssueComment, true);
	assertEquals(facts.commentBody, "/yoroi status");
	assertEquals(facts.commentActorNodeId, "U_actor1");
});

Deno.test("minimalEventFacts: repository/pull_requestが欠けていてもnullで埋めて例外を投げない", () => {
	const facts = minimalEventFacts("installation", {}) as MinimalEventFacts;
	assertEquals(facts.repoFullName, null);
	assertEquals(facts.pullRequestNumber, null);
});

Deno.test("minimalEventFacts: issue_comment以外ではcommentBodyを含めない (FR-002: 過剰な保持をしない)", () => {
	const facts = minimalEventFacts("pull_request", {
		repository: { full_name: "acme/widgets" },
		pull_request: { number: 1 },
		comment: { body: "should not leak here" },
	}) as MinimalEventFacts;
	assertEquals(facts.commentBody, null);
});
