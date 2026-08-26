import { z } from "zod";

/**
 * design.md §12.1's DecisionEnvelope. `operationId`/`fencingToken` are typed
 * more strictly here than the doc's illustrative snippet:
 *  - `operationId` is a ULID (packages/domain's `OperationId` comment says so
 *    explicitly), not a UUID — `z.string().uuid()` would reject a real ULID,
 *    so this validates the actual Crockford base32 ULID shape instead.
 *  - `fencingToken` is a bigint serialized as a decimal string (it comes
 *    straight out of `branch_coordinator.fencing_token`, a Postgres BIGINT) —
 *    validated as a non-negative integer string, not an arbitrary string.
 *
 * `owner`/`repoName`/`baseRef` are additions beyond design.md's own field
 * list: the doc's envelope carries `repositoryId` (numeric) but nothing a
 * GitHub REST call or the Branch Coordinator's `(installationId,
 * repositoryId, targetBranch)` key can use directly. Rather than have
 * yoroi-merger look these up from apps/control's database (a trust
 * dependency the signed-envelope design is explicitly built to avoid —
 * Merger should need nothing but the envelope + its own GitHub credentials),
 * they're carried in the envelope itself and covered by the same signature.
 */

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const NONNEGATIVE_INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;

const ShaSchema = z.string().regex(SHA_PATTERN, "must be a 40-hex-char git SHA");
const DigestSchema = z.string().regex(DIGEST_PATTERN, "must be a 64-hex-char SHA-256 digest");

export const DecisionEnvelopeSchema = z
	.object({
		operationId: z.string().regex(ULID_PATTERN, "must be a ULID"),
		installationId: z.number().int().positive(),
		repositoryId: z.number().int().positive(),
		owner: z.string().min(1),
		repoName: z.string().min(1),
		pullRequestNumber: z.number().int().positive(),
		headSha: ShaSchema,
		baseSha: ShaSchema,
		baseRef: z.string().min(1),
		dependencyShas: z.array(ShaSchema),
		candidateSha: ShaSchema,
		scopeReviewProofs: z.record(
			z.string(),
			z
				.object({
					changeDigest: DigestSchema,
					resultDigest: DigestSchema,
					contextProofDigest: DigestSchema,
				})
				.strict(),
		),
		policyDigest: DigestSchema,
		approvalDigest: DigestSchema,
		checkPlanDigest: DigestSchema,
		evidenceDigest: DigestSchema,
		fencingToken: z.string().regex(
			NONNEGATIVE_INTEGER_PATTERN,
			"must be a non-negative integer string",
		),
		denoRevisionId: z.string().min(1),
		expiresAt: z.string().datetime(),
	})
	.strict();

export type DecisionEnvelope = z.infer<typeof DecisionEnvelopeSchema>;

/** design.md §12.3 step 2: an envelope past its own `expiresAt` is rejected
 * before any other check runs. */
export function isExpired(envelope: DecisionEnvelope, now: Date = new Date()): boolean {
	return new Date(envelope.expiresAt).getTime() <= now.getTime();
}
