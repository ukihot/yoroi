/**
 * design.md §4.1, verbatim. Branded types so `repository_id` and
 * `installation_id` (etc.) can never be silently swapped — a plain
 * `number`/`string` mixup here is exactly the class of bug SEC-019 (cross-repo
 * data confusion) warns about.
 */

type Brand<Base, Tag extends string> = Base & { readonly __brand: Tag };

export type InstallationId = Brand<number, "InstallationId">;
export type RepositoryId = Brand<number, "RepositoryId">;
export type PullRequestNumber = Brand<number, "PullRequestNumber">;
export type Sha = Brand<string, "Sha">; // commit/tree/blob OID
export type Sha256Hex = Brand<string, "Sha256Hex">; // digest全般
export type OperationId = Brand<string, "OperationId">; // ULID
export type DecisionId = Brand<string, "DecisionId">; // ULID
export type ActorStableId = Brand<string, "ActorStableId">; // GitHub user node_id
export type ScopeId = Brand<string, "ScopeId">;
export type FencingToken = Brand<bigint, "FencingToken">;
export type PolicyDigest = Brand<string, "PolicyDigest">;

export function installationId(value: number): InstallationId {
	return value as InstallationId;
}
export function repositoryId(value: number): RepositoryId {
	return value as RepositoryId;
}
export function pullRequestNumber(value: number): PullRequestNumber {
	return value as PullRequestNumber;
}
export function sha(value: string): Sha {
	return value as Sha;
}
export function sha256Hex(value: string): Sha256Hex {
	return value as Sha256Hex;
}
export function operationId(value: string): OperationId {
	return value as OperationId;
}
export function decisionId(value: string): DecisionId {
	return value as DecisionId;
}
export function actorStableId(value: string): ActorStableId {
	return value as ActorStableId;
}
export function scopeId(value: string): ScopeId {
	return value as ScopeId;
}
export function fencingToken(value: bigint): FencingToken {
	return value as FencingToken;
}
export function policyDigest(value: string): PolicyDigest {
	return value as PolicyDigest;
}
