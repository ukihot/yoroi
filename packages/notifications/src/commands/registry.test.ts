import { assertEquals } from "@std/assert";
import { COMMANDS, dispatchCommand, parseCommand } from "./registry.ts";
import type { CommandContext, CommandPorts } from "./types.ts";
import { actorStableId, installationId, pullRequestNumber, repositoryId, sha } from "@yoroi/domain";

Deno.test("parseCommand: /yoroi <name> <args...> を解析する", () => {
	assertEquals(parseCommand("/yoroi flaky report test-42"), {
		name: "flaky",
		args: ["report", "test-42"],
	});
});

Deno.test("parseCommand: 引数なしのcommandも解析できる", () => {
	assertEquals(parseCommand("/yoroi status"), { name: "status", args: [] });
});

Deno.test("parseCommand: 前後の空白は無視する", () => {
	assertEquals(parseCommand("  /yoroi help  "), { name: "help", args: [] });
});

Deno.test("parseCommand: /yoroiで始まらない文字列はnull", () => {
	assertEquals(parseCommand("just a comment"), null);
	assertEquals(parseCommand("please /yoroi status"), null);
});

Deno.test("parseCommand: 大文字を含むcommand名は現在の実装では受理しない", () => {
	assertEquals(parseCommand("/yoroi Status"), null);
});

Deno.test("COMMANDS: design.md §9.9.1の7つのcommandが揃っている", () => {
	const names = COMMANDS.map((c) => c.name).sort();
	assertEquals(names, ["feedback", "flaky", "help", "queue", "recheck", "status", "why"].sort());
});

Deno.test("COMMANDS: priority/pause/freeze/break-glass/policyは公開されない (design.md §15.1)", () => {
	const names = new Set(COMMANDS.map((c) => c.name));
	for (const forbidden of ["priority", "pause", "freeze", "break-glass", "policy"]) {
		assertEquals(names.has(forbidden), false);
	}
});

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
		repoPermission: "read",
		isPrAuthor: false,
		observedHeadSha: sha("a".repeat(40)),
		...overrides,
	};
}

const unusedPorts = {} as CommandPorts;

Deno.test("dispatchCommand: パースできないtextはunknown_command", async () => {
	const result = await dispatchCommand(ctx(), "hello", unusedPorts);
	assertEquals(result.kind, "unknown_command");
});

Deno.test("dispatchCommand: 存在しないcommand名もunknown_command", async () => {
	const result = await dispatchCommand(ctx(), "/yoroi nonexistent", unusedPorts);
	assertEquals(result.kind, "unknown_command");
});

Deno.test("dispatchCommand: 権限不足はdeniedになる（read権限でqueueを実行）", async () => {
	const result = await dispatchCommand(
		ctx({ repoPermission: "read" }),
		"/yoroi queue",
		unusedPorts,
	);
	assertEquals(result.kind, "denied");
});

Deno.test("dispatchCommand: PR authorはwrite権限がなくてもrecheckを実行できる (allowPrAuthor)", async () => {
	const ports: CommandPorts = {
		...unusedPorts,
		tryAcquireCooldown: () => Promise.resolve(false),
	};
	const result = await dispatchCommand(
		ctx({ repoPermission: "read", isPrAuthor: true }),
		"/yoroi recheck",
		ports,
	);
	assertEquals(result.kind, "pending"); // cooldown中だが、権限では弾かれていない
});

Deno.test("dispatchCommand: helpはportsを使わず全commandを一覧できる", async () => {
	const result = await dispatchCommand(ctx(), "/yoroi help", unusedPorts);
	assertEquals(result.kind, "ok");
	if (result.kind !== "ok") return;
	for (const spec of COMMANDS) {
		assertEquals(result.markdown.includes(`/yoroi ${spec.name}`), true);
	}
});
