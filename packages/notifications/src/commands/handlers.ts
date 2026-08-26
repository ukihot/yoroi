import { formatEtaRangeJa, renderReasonGraphMarkdown } from "../render.ts";
import { type CommandHandler, PERMISSION_RANK } from "./types.ts";

const FEEDBACK_CATEGORIES = [
	"false-block",
	"wrong-owner",
	"wrong-check-plan",
	"unexplained-rerun",
	"eta",
	"accessibility",
	"other",
] as const;

/** `/yoroi status` — design.md §9.9.1: re-displays the current summary,
 * makes no changes. */
export const handleStatus: CommandHandler = async (ctx, _args, ports) => {
	const snapshot = await ports.getGateSnapshot(ctx.repo, ctx.pullRequestNumber);
	if (!snapshot) return { kind: "ok", markdown: "まだ判定情報がありません。" };
	return {
		kind: "ok",
		markdown: `現在の判定: **${snapshot.gateConclusion}**（head: ${snapshot.headSha}）`,
	};
};

/** `/yoroi why [gate]` — expands the reason graph. `args[0]` (a gate name
 * like "G1") is accepted but not yet used to filter the graph — the full
 * graph is small enough to show entirely; scoping to one gate is a follow-up
 * once reason graphs grow large enough to need it. */
export const handleWhy: CommandHandler = async (ctx, _args, ports) => {
	const snapshot = await ports.getGateSnapshot(ctx.repo, ctx.pullRequestNumber);
	if (!snapshot) return { kind: "ok", markdown: "まだ判定情報がありません。" };
	return { kind: "ok", markdown: renderReasonGraphMarkdown(snapshot.reasonGraph) };
};

/**
 * `/yoroi recheck` — design.md §15.2/§9.9.2/AT-29/AT-30. Coalesces on
 * `repo+pr+observedHeadSha`, never publishes a result computed against a
 * head that's since moved, and always leaves an audit trail even when the
 * outcome is "unchanged".
 */
export const handleRecheck: CommandHandler = async (ctx, _args, ports) => {
	const cooldownKey =
		`recheck:${ctx.repo.repositoryId}:${ctx.pullRequestNumber}:${ctx.observedHeadSha}`;
	const acquired = await ports.tryAcquireCooldown(cooldownKey, 60);
	if (!acquired) {
		return {
			kind: "pending",
			markdown: "すでに再照合中です（60秒のcooldown中）。しばらくお待ちください。",
		};
	}

	const freshHeadSha = await ports.refetchAuthoritativeHeadSha(ctx.repo, ctx.pullRequestNumber);
	if (freshHeadSha !== ctx.observedHeadSha) {
		return {
			kind: "pending",
			markdown:
				`headが更新されています（新SHA: ${freshHeadSha}）。新しいheadに対する判定を待っています。`,
		};
	}

	const before = await ports.getGateSnapshot(ctx.repo, ctx.pullRequestNumber);
	const after = await ports.reevaluate(ctx.repo, ctx.pullRequestNumber);
	await ports.recordAuditEvent({
		kind: "recheck",
		actorStableId: ctx.actorStableId,
		before,
		after,
	});

	if (before && before.gateConclusion === after.gateConclusion) {
		return { kind: "ok", markdown: `再照合済み・変化なし（${new Date().toISOString()}）` };
	}
	return {
		kind: "ok",
		markdown: `判定が変化しました: ${
			before?.gateConclusion ?? "(判定情報なし)"
		} → ${after.gateConclusion}`,
	};
};

/** `/yoroi queue` — design.md §9.9.1: re-displays queue position/lane/ETA,
 * changes no priority. */
export const handleQueue: CommandHandler = async (ctx, _args, ports) => {
	const snapshot = await ports.getQueueSnapshot(ctx.repo, ctx.pullRequestNumber);
	if (!snapshot) return { kind: "ok", markdown: "現在queueには入っていません。" };
	const etaRange: readonly [Date, Date] | null = snapshot.etaFrom && snapshot.etaTo
		? [snapshot.etaFrom, snapshot.etaTo]
		: null;
	return {
		kind: "ok",
		markdown: `queue位置: ${snapshot.position ?? "不明"}（lane: ${snapshot.lane}）\n` +
			`ETA: ${formatEtaRangeJa(etaRange, snapshot.etaConfidence)}`,
	};
};

/**
 * `/yoroi flaky report <test-id>` and `/yoroi flaky quarantine-request
 * <test-id>` — design.md §9.9.3. Both live under the single top-level
 * `flaky` command name (registered at `minPermission: "read"` so `report`
 * stays open to any CI-viewing contributor); `quarantine-request` enforces
 * its own higher bar (write) here rather than at the registry level, since
 * the two subcommands have different minimum permissions (design.md's own
 * table: report = contributor, quarantine-request = repo write+).
 */
export const handleFlakySubcommand: CommandHandler = async (ctx, args, ports) => {
	const [subcommand, testId] = args;
	if (!testId) {
		return {
			kind: "denied",
			reason: "test-idを指定してください: /yoroi flaky report <test-id>",
		};
	}

	if (subcommand === "report") {
		const result = await ports.recordFlakyReport({
			repo: ctx.repo,
			testId,
			runUrl: "",
			actorStableId: ctx.actorStableId,
		});
		return {
			kind: "ok",
			markdown: `flaky候補として記録しました（confidence: ${result.confidence}, ` +
				`fingerprint: ${result.failureFingerprint}）`,
		};
	}

	if (subcommand === "quarantine-request") {
		if (PERMISSION_RANK[ctx.repoPermission] < PERMISSION_RANK["write"]) {
			return { kind: "denied", reason: "quarantine-requestにはrepo write以上の権限が必要です" };
		}
		const proposal = await ports.createFlakyQuarantineProposal({
			repo: ctx.repo,
			testId,
			owner: ctx.actorStableId,
			reason: "self-service quarantine request",
			expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60_000),
			actorStableId: ctx.actorStableId,
		});
		return {
			kind: "ok",
			markdown:
				`quarantine提案を作成しました（proposal: ${proposal.proposalId}）。承認者の承認待ちです。`,
		};
	}

	return {
		kind: "denied",
		reason: "サブコマンドは report または quarantine-request のいずれかです",
	};
};

/** `/yoroi feedback <category> [description]` — design.md §9.9.4. */
export const handleFeedback: CommandHandler = async (ctx, args, ports) => {
	const [category, ...descriptionParts] = args;
	if (!category || !(FEEDBACK_CATEGORIES as readonly string[]).includes(category)) {
		return {
			kind: "denied",
			reason: `categoryは次のいずれかを指定してください: ${FEEDBACK_CATEGORIES.join(", ")}`,
		};
	}
	const result = await ports.recordFeedback({
		repo: ctx.repo,
		pullRequestNumber: ctx.pullRequestNumber,
		category,
		actorStableId: ctx.actorStableId,
		description: descriptionParts.join(" "),
	});
	return { kind: "ok", markdown: `フィードバックを受け付けました（case #${result.id}）。` };
};
