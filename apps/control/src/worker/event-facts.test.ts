import { assertEquals } from "@std/assert";
import { parseEventFacts } from "./event-facts.ts";

Deno.test("parseEventFacts: 完全なpayloadをそのまま復元する", () => {
	const facts = parseEventFacts({
		eventType: "pull_request",
		action: "opened",
		repoFullName: "acme/widgets",
		pullRequestNumber: 5,
		isIssueComment: false,
		commentBody: null,
		commentActorNodeId: null,
	});
	assertEquals(facts.repoFullName, "acme/widgets");
	assertEquals(facts.pullRequestNumber, 5);
});

Deno.test("parseEventFacts: 欠けているfieldは安全な既定値で埋める", () => {
	const facts = parseEventFacts({});
	assertEquals(facts.eventType, "");
	assertEquals(facts.action, null);
	assertEquals(facts.repoFullName, null);
	assertEquals(facts.pullRequestNumber, null);
	assertEquals(facts.isIssueComment, false);
});

Deno.test("parseEventFacts: nullやundefinedのpayloadでも例外を投げない (outbox再処理時の安全性)", () => {
	assertEquals(parseEventFacts(null).repoFullName, null);
	assertEquals(parseEventFacts(undefined).repoFullName, null);
});

Deno.test("parseEventFacts: 想定外の型が混じっていてもそのまま通す（jsonbなのでランタイム検証はしない）", () => {
	// jsonbから読み戻した値はTypeScript的にはPartial<MinimalEventFacts>として
	// 信頼するしかない — ここでは意図的な誤用を防ぐものではなく、書き込み側
	// (webhook.ts's minimalEventFacts)が正しい形を作ることが前提。
	const facts = parseEventFacts({ pullRequestNumber: "not-a-number" as unknown as number });
	assertEquals(facts.pullRequestNumber, "not-a-number" as unknown);
});
