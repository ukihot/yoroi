import { type Span, SpanStatusCode, trace } from "@opentelemetry/api";
import type { FencingToken, OperationId, PolicyDigest, RepositoryId, Sha } from "@yoroi/domain";

/**
 * design.md §18.1. Built-in observability is diagnostic-only — `decision_event`
 * (packages/postgres) plus external evidence export (packages/evidence) is the
 * audit system of record (SEC-037); spans exist to make the §18.2 trace chain
 * (webhook → inbox → policy eval → check run → candidate → CI evidence →
 * merger → GitHub response) walkable in a trace backend, not to prove
 * anything by themselves.
 *
 * `configureServiceName` lets each app (`apps/control`, `apps/merger`) pick
 * its own tracer name at startup — design.md's snippet hardcodes
 * `trace.getTracer("yoroi-control")`, but this package is shared by both apps
 * (`packages/domain/deno.jsonc`'s own comment names `apps/merger` as a future
 * consumer too), so the tracer name is a configurable default instead of a
 * literal baked into the package.
 */

let serviceName = "yoroi";

export function configureServiceName(name: string): void {
	serviceName = name;
}

export interface SpanAttrs {
	readonly operationId?: OperationId;
	readonly repositoryId?: RepositoryId;
	readonly headSha?: Sha;
	readonly candidateSha?: Sha;
	readonly policyDigest?: PolicyDigest;
	readonly fencingToken?: FencingToken;
}

function setYoroiAttributes(span: Span, attrs: SpanAttrs): void {
	if (attrs.operationId !== undefined) span.setAttribute("yoroi.operation_id", attrs.operationId);
	if (attrs.repositoryId !== undefined) {
		span.setAttribute("yoroi.repository_id", attrs.repositoryId);
	}
	if (attrs.headSha !== undefined) span.setAttribute("yoroi.head_sha", attrs.headSha);
	if (attrs.candidateSha !== undefined) {
		span.setAttribute("yoroi.candidate_sha", attrs.candidateSha);
	}
	if (attrs.policyDigest !== undefined) {
		span.setAttribute("yoroi.policy_digest", attrs.policyDigest);
	}
	if (attrs.fencingToken !== undefined) {
		span.setAttribute("yoroi.fencing_token", attrs.fencingToken.toString());
	}

	// design.md §17: Deno Deploy sets these at runtime; both are undefined
	// (not required) outside Deno Deploy, e.g. local `deno task dev`.
	const revisionId = envVarOrUndefined("DENO_DEPLOYMENT_ID");
	if (revisionId !== undefined) span.setAttribute("yoroi.deno_revision_id", revisionId);
	const deployContext = envVarOrUndefined("DENO_DEPLOY_CONTEXT");
	if (deployContext !== undefined) span.setAttribute("yoroi.deno_context", deployContext);
}

function envVarOrUndefined(name: string): string | undefined {
	// `Deno.env` is unavailable under some restricted permission sets; treat
	// that the same as "not set" rather than throwing from inside a span.
	try {
		return Deno.env.get(name);
	} catch {
		return undefined;
	}
}

/**
 * design.md §18.1: sets `yoroi.*` span attributes, records exceptions via
 * `span.recordException`, rethrows, always ends the span — secrets, tokens,
 * Authorization headers, and private repo body content must never be passed
 * in `attrs` or thrown into `fn` (§19.2); this wrapper doesn't scrub anything
 * itself, callers are responsible for only passing safe attribute values.
 */
export function withSpan<T>(
	name: string,
	attrs: SpanAttrs,
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	const tracer = trace.getTracer(serviceName);
	return tracer.startActiveSpan(name, async (span) => {
		setYoroiAttributes(span, attrs);
		try {
			const result = await fn(span);
			span.end();
			return result;
		} catch (error) {
			span.recordException(error instanceof Error ? error : String(error));
			span.setStatus({ code: SpanStatusCode.ERROR });
			span.end();
			throw error;
		}
	});
}
