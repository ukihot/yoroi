import { verifyHmacSignature } from "@yoroi/github";
import { insertInboxAndOutbox } from "@yoroi/postgres";
import { getEnv, mustGetEnv } from "../env.ts";
import { getControlContext } from "../context.ts";
import { drainOutbox } from "../worker/outbox.ts";

const MAX_PAYLOAD_BYTES = 5_000_000;

export const EVENT_ALLOWLIST = new Set([
	"pull_request",
	"pull_request_review",
	"issue_comment",
	"check_run",
	"check_suite",
	"status",
	"push",
	"installation",
	"installation_repositories",
]);

// design.md §7.1 shouldPersistRaw/FR-002: only these are worth keeping the
// raw (encrypted, short-TTL) payload for — the rest only need the minimal
// facts already extracted into the outbox work item.
const RAW_PERSIST_EVENTS = new Set(["pull_request", "pull_request_review", "issue_comment"]);

export function routeEventToWorkKind(eventType: string): string {
	switch (eventType) {
		case "issue_comment":
			return "handle_slash_command";
		case "check_run":
		case "check_suite":
		case "status":
			return "ingest_check_result";
		case "pull_request":
		case "pull_request_review":
			return "evaluate_policy";
		default:
			return "reconcile_hint";
	}
}

interface WebhookInstallation {
	readonly id?: number;
}
interface WebhookRepository {
	readonly id?: number;
	readonly full_name?: string;
}
interface WebhookComment {
	readonly body?: string;
	readonly user?: { readonly node_id?: string };
}

function extractInstallationId(payload: Record<string, unknown>): number {
	return (payload.installation as WebhookInstallation | undefined)?.id ?? 0;
}

function extractRepositoryId(payload: Record<string, unknown>): number | null {
	return (payload.repository as WebhookRepository | undefined)?.id ?? null;
}

export function minimalEventFacts(eventType: string, payload: Record<string, unknown>): unknown {
	const repo = payload.repository as WebhookRepository | undefined;
	const pr = payload.pull_request as { number?: number } | undefined;
	const issue = payload.issue as { number?: number } | undefined;
	const comment = payload.comment as WebhookComment | undefined;
	return {
		eventType,
		action: (payload.action as string | undefined) ?? null,
		repoFullName: repo?.full_name ?? null,
		pullRequestNumber: pr?.number ?? issue?.number ?? null,
		isIssueComment: eventType === "issue_comment",
		commentBody: eventType === "issue_comment" ? comment?.body ?? null : null,
		commentActorNodeId: eventType === "issue_comment" ? comment?.user?.node_id ?? null : null,
	};
}

function toDigestInput(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", toDigestInput(bytes));
	return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * design.md §7.1. Size cap → event allowlist → raw-body HMAC → parse →
 * single-transaction inbox+outbox insert → bounded drain within the request
 * budget → 202. No detached Promise after the response carries the primary
 * delivery path (§7.4's checklist) — commit and bounded drain are both
 * `await`ed before responding.
 */
export async function handleWebhook(req: Request): Promise<Response> {
	const contentLength = Number(req.headers.get("content-length") ?? "0");
	if (contentLength > MAX_PAYLOAD_BYTES) return new Response("payload too large", { status: 413 });

	const eventType = req.headers.get("x-github-event");
	if (!eventType || !EVENT_ALLOWLIST.has(eventType)) {
		return new Response(null, { status: 202 }); // 未知eventは黙って受理しdrop
	}

	const rawBody = new Uint8Array(await req.arrayBuffer());
	if (rawBody.byteLength > MAX_PAYLOAD_BYTES) {
		return new Response("payload too large", { status: 413 });
	}

	const signature = req.headers.get("x-hub-signature-256");
	if (!(await verifyHmacSignature(rawBody, signature, mustGetEnv("GITHUB_WEBHOOK_SECRET")))) {
		return new Response("bad signature", { status: 401 });
	}

	const deliveryId = req.headers.get("x-github-delivery");
	if (!deliveryId) return new Response("missing delivery id", { status: 400 });

	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(new TextDecoder().decode(rawBody));
	} catch {
		return new Response("invalid JSON payload", { status: 400 });
	}

	const ctx = getControlContext();
	const installationId = extractInstallationId(payload);
	const repositoryId = extractRepositoryId(payload);
	// work_outbox.operation_id is a UUID per design.md §6.3's raw DDL (distinct
	// from the ULID-typed OperationId branded domain type used in decision
	// envelopes/state events — see packages/domain/src/ulid.ts's comment).
	const operationId = crypto.randomUUID();
	const encryptionKey = getEnv("WEBHOOK_PAYLOAD_ENCRYPTION_KEY", "");

	const { inserted } = await insertInboxAndOutbox(
		ctx.db,
		{
			installationId,
			repositoryId,
			deliveryId,
			eventType,
			payloadDigest: await sha256Hex(rawBody),
			rawPayload: RAW_PERSIST_EVENTS.has(eventType) ? rawBody : null,
			encryptionKey: RAW_PERSIST_EVENTS.has(eventType) && encryptionKey ? encryptionKey : null,
			ttlHours: 24,
		},
		{
			operationId,
			installationId,
			repositoryId,
			kind: routeEventToWorkKind(eventType),
			payload: minimalEventFacts(eventType, payload),
		},
	);

	// FR-004: 重複delivery (既にinboxにある) ならoutboxへ積み増ししない
	if (inserted) {
		await drainOutbox(ctx, { budgetMs: 6000, limit: 20 });
	}

	return new Response(null, { status: 202 });
}
