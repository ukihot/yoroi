import type { PolicyDigest, ScopeId } from "@yoroi/domain";
import { policyDigest as toPolicyDigest } from "@yoroi/domain";
import { err, ok, type Result } from "@yoroi/domain";
import { type PolicyDocument, PolicySchema, type ScopeRule } from "./schema.ts";

export interface CompiledPolicy {
	readonly digest: PolicyDigest;
	readonly raw: PolicyDocument;
	readonly scopeIndex: ReadonlyMap<ScopeId, ScopeRule>;
}

export type PolicyError =
	| { readonly kind: "SCHEMA_INVALID"; readonly issues: unknown }
	| { readonly kind: "CYCLIC_INHERITANCE" }
	| { readonly kind: "EMPTY_REQUIRED_CHECK_SET" };

/** Deep-merge with **explicit override**: a key present in the more specific
 * document replaces the less specific one (objects merge key-by-key
 * recursively; arrays replace wholesale — merging config arrays element-wise
 * has too many surprising edge cases for a security-relevant document, P-08:
 * no implicit last-match-wins). */
function mergeExplicit(base: unknown, override: unknown): unknown {
	if (override === undefined) return base;
	if (
		typeof base === "object" &&
		base !== null &&
		!Array.isArray(base) &&
		typeof override === "object" &&
		override !== null &&
		!Array.isArray(override)
	) {
		const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
		for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
			result[key] = mergeExplicit((base as Record<string, unknown>)[key], value);
		}
		return result;
	}
	return override;
}

function mergeWithExplicitOverride(
	org: PolicyDocument,
	repo: Partial<PolicyDocument> | null,
	branch: Partial<PolicyDocument> | null,
): unknown {
	let merged: unknown = org;
	if (repo) merged = mergeExplicit(merged, repo);
	if (branch) merged = mergeExplicit(merged, branch);
	return merged;
}

/**
 * The current PolicySchema (§9.1, ported verbatim in schema.ts) has no
 * self-referencing `extends:`/inheritance field of its own — org→repo→branch
 * is a fixed 3-level chain applied by the caller, not a graph the document
 * itself can describe. So there is nothing for this check to catch yet; it
 * stays as an explicit placeholder rather than a check that silently does
 * nothing without saying so, in case such a field is added later.
 */
function hasCyclicInheritance(_merged: unknown): boolean {
	return false;
}

function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeysDeep);
	if (value !== null && typeof value === "object") {
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
		}
		return sorted;
	}
	return value;
}

function toCanonicalJson(value: unknown): string {
	return JSON.stringify(sortKeysDeep(value));
}

async function digestOf(canonicalJson: string): Promise<PolicyDigest> {
	const bytes = new TextEncoder().encode(canonicalJson);
	const buffer = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
	const hash = await crypto.subtle.digest("SHA-256", buffer);
	const hex = Array.from(new Uint8Array(hash))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return toPolicyDigest(hex);
}

function buildScopeIndex(scopes: readonly ScopeRule[]): ReadonlyMap<ScopeId, ScopeRule> {
	return new Map(scopes.map((s) => [s.id as ScopeId, s]));
}

/**
 * design.md §9.2. Async (`digestOf` uses Web Crypto, which has no
 * synchronous digest API in Deno — the doc's illustrative `sha256HexSync`
 * name doesn't map to a real API; this returns a Promise instead).
 */
export async function compilePolicy(
	org: PolicyDocument,
	repo: Partial<PolicyDocument> | null,
	branch: Partial<PolicyDocument> | null,
): Promise<Result<CompiledPolicy, PolicyError>> {
	const merged = mergeWithExplicitOverride(org, repo, branch);
	const validation = PolicySchema.safeParse(merged);
	if (!validation.success) return err({ kind: "SCHEMA_INVALID", issues: validation.error.issues });

	if (hasCyclicInheritance(merged)) return err({ kind: "CYCLIC_INHERITANCE" });
	if (validation.data.scopes.some((s) => s.require.checks?.length === 0)) {
		return err({ kind: "EMPTY_REQUIRED_CHECK_SET" }); // FR-012: 空の必須check集合は安全側error
	}

	const canonicalJson = toCanonicalJson(validation.data);
	return ok({
		digest: await digestOf(canonicalJson),
		raw: validation.data,
		scopeIndex: buildScopeIndex(validation.data.scopes),
	});
}

/**
 * design.md §9.4 (P-12, SEC-026): a policy-change PR is evaluated against
 * the policy that was in effect *before* the change, never its own
 * candidate policy — otherwise a PR could weaken its own approval
 * requirements. The caller passes whatever `policy_bundle` row is currently
 * effective in the DB; this function is intentionally a no-op wrapper so the
 * call site (not a hidden default) is where that guarantee is visible.
 */
export function resolvePolicyForEvaluation(currentEffectivePolicy: CompiledPolicy): CompiledPolicy {
	return currentEffectivePolicy;
}
