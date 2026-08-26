import { assertEquals, assertStringIncludes } from "@std/assert";
import {
	handleFeedback,
	handleFlakySubcommand,
	handleQueue,
	handleRecheck,
	handleStatus,
	handleWhy,
} from "./handlers.ts";
import type { CommandContext, CommandPorts, GateSnapshot, QueueSnapshot } from "./types.ts";
import { actorStableId, installationId, pullRequestNumber, repositoryId, sha } from "@yoroi/domain";

function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
	return {
		repo: {
			installationId: installationId(1),
			repositoryId: repositoryId(2),
			owner: "org",
			name: "repo",
		},
		pullRequestNumber: pullRequestNumber(1),
		actorStableId: actorStableId("u1"),
		repoPermission: "write",
		isPrAuthor: false,
		observedHeadSha: sha("a".repeat(40)),
		...overrides,
	};
}

function fakePorts(overrides: Partial<CommandPorts> = {}): CommandPorts {
	return {
		getGateSnapshot: () => Promise.resolve(null),
		getQueueSnapshot: () => Promise.resolve(null),
		refetchAuthoritativeHeadSha: () => Promise.resolve(sha("a".repeat(40))),
		reevaluate: () =>
			Promise.resolve({
				headSha: sha("a".repeat(40)),
				gateConclusion: "PASS",
				reasonGraph: { label: "Merge可能", children: [] },
			}),
		tryAcquireCooldown: () => Promise.resolve(true),
		recordAuditEvent: () => Promise.resolve(),
		recordFlakyReport: () =>
			Promise.resolve({ confidence: "possible_change_related", failureFingerprint: "fp-1" }),
		createFlakyQuarantineProposal: () => Promise.resolve({ proposalId: "proposal-1" }),
		recordFeedback: () => Promise.resolve({ id: 1 }),
		...overrides,
	};
}

// --- status / why -----------------------------------------------------

Deno.test("handleStatus: snapshotがなければ判定情報なしと返す", async () => {
	const result = await handleStatus(ctx(), [], fakePorts());
	assertEquals(result.kind, "ok");
	if (result.kind === "ok") assertStringIncludes(result.markdown, "判定情報がありません");
});

Deno.test("handleStatus: snapshotがあればgateConclusionを表示する", async () => {
	const snapshot: GateSnapshot = {
		headSha: sha("a".repeat(40)),
		gateConclusion: "BLOCKED",
		reasonGraph: { label: "Merge不可", children: [] },
	};
	const result = await handleStatus(
		ctx(),
		[],
		fakePorts({ getGateSnapshot: () => Promise.resolve(snapshot) }),
	);
	assertEquals(result.kind, "ok");
	if (result.kind === "ok") assertStringIncludes(result.markdown, "BLOCKED");
});

Deno.test("handleWhy: reason graph全体を展開する", async () => {
	const snapshot: GateSnapshot = {
		headSha: sha("a".repeat(40)),
		gateConclusion: "BLOCKED",
		reasonGraph: { label: "Merge不可", children: [{ label: "承認不足", children: [] }] },
	};
	const result = await handleWhy(
		ctx(),
		[],
		fakePorts({ getGateSnapshot: () => Promise.resolve(snapshot) }),
	);
	assertEquals(result.kind, "ok");
	if (result.kind === "ok") assertStringIncludes(result.markdown, "承認不足");
});

// --- recheck ------------------------------------------------------------

Deno.test("handleRecheck: cooldown中はpendingを返す (AT-30)", async () => {
	const result = await handleRecheck(
		ctx(),
		[],
		fakePorts({ tryAcquireCooldown: () => Promise.resolve(false) }),
	);
	assertEquals(result.kind, "pending");
});

Deno.test("handleRecheck: headが動いていればstale結果を公開せずpendingを返す (AT-29)", async () => {
	const result = await handleRecheck(
		ctx({ observedHeadSha: sha("a".repeat(40)) }),
		[],
		fakePorts({ refetchAuthoritativeHeadSha: () => Promise.resolve(sha("b".repeat(40))) }),
	);
	assertEquals(result.kind, "pending");
});

Deno.test("handleRecheck: 判定が変わらなければ「変化なし」を返す", async () => {
	const snapshot: GateSnapshot = {
		headSha: sha("a".repeat(40)),
		gateConclusion: "PASS",
		reasonGraph: { label: "Merge可能", children: [] },
	};
	const result = await handleRecheck(
		ctx(),
		[],
		fakePorts({ getGateSnapshot: () => Promise.resolve(snapshot) }),
	);
	assertEquals(result.kind, "ok");
	if (result.kind === "ok") assertStringIncludes(result.markdown, "変化なし");
});

Deno.test("handleRecheck: 判定が変われば差分を示す", async () => {
	const before: GateSnapshot = {
		headSha: sha("a".repeat(40)),
		gateConclusion: "BLOCKED",
		reasonGraph: { label: "Merge不可", children: [] },
	};
	const result = await handleRecheck(
		ctx(),
		[],
		fakePorts({ getGateSnapshot: () => Promise.resolve(before) }), // reevaluate defaults to PASS
	);
	assertEquals(result.kind, "ok");
	if (result.kind === "ok") assertStringIncludes(result.markdown, "BLOCKED → PASS");
});

// --- queue ----------------------------------------------------------------

Deno.test("handleQueue: queueに入っていなければその旨を返す", async () => {
	const result = await handleQueue(ctx(), [], fakePorts());
	assertEquals(result.kind, "ok");
	if (result.kind === "ok") assertStringIncludes(result.markdown, "queueには入っていません");
});

Deno.test("handleQueue: queue位置とETAを表示する", async () => {
	const snapshot: QueueSnapshot = {
		position: 3,
		lane: "default",
		etaFrom: new Date("2026-08-26T10:00:00.000Z"),
		etaTo: new Date("2026-08-26T11:00:00.000Z"),
		etaConfidence: "medium",
	};
	const result = await handleQueue(
		ctx(),
		[],
		fakePorts({ getQueueSnapshot: () => Promise.resolve(snapshot) }),
	);
	assertEquals(result.kind, "ok");
	if (result.kind === "ok") {
		assertStringIncludes(result.markdown, "queue位置: 3");
		assertStringIncludes(result.markdown, "信頼度: 中");
	}
});

// --- flaky ------------------------------------------------------------

Deno.test("handleFlakySubcommand: test-idがなければdenied", async () => {
	const result = await handleFlakySubcommand(ctx(), ["report"], fakePorts());
	assertEquals(result.kind, "denied");
});

Deno.test("handleFlakySubcommand: reportはread権限でも実行できる", async () => {
	const result = await handleFlakySubcommand(
		ctx({ repoPermission: "read" }),
		["report", "test-42"],
		fakePorts(),
	);
	assertEquals(result.kind, "ok");
});

Deno.test("handleFlakySubcommand: quarantine-requestはread権限だとdenied", async () => {
	const result = await handleFlakySubcommand(
		ctx({ repoPermission: "read" }),
		["quarantine-request", "test-42"],
		fakePorts(),
	);
	assertEquals(result.kind, "denied");
});

Deno.test("handleFlakySubcommand: quarantine-requestはwrite権限なら実行できる", async () => {
	const result = await handleFlakySubcommand(
		ctx({ repoPermission: "write" }),
		["quarantine-request", "test-42"],
		fakePorts(),
	);
	assertEquals(result.kind, "ok");
});

Deno.test("handleFlakySubcommand: 未知のsubcommandはdenied", async () => {
	const result = await handleFlakySubcommand(ctx(), ["bogus", "test-42"], fakePorts());
	assertEquals(result.kind, "denied");
});

// --- feedback ---------------------------------------------------------

Deno.test("handleFeedback: 未知categoryはdenied", async () => {
	const result = await handleFeedback(ctx(), ["not-a-real-category"], fakePorts());
	assertEquals(result.kind, "denied");
});

Deno.test("handleFeedback: 正しいcategoryは受け付けられる", async () => {
	const result = await handleFeedback(ctx(), ["wrong-owner", "説明文"], fakePorts());
	assertEquals(result.kind, "ok");
});
