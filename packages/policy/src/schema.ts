import { z } from 'zod';

/**
 * design.md §9.1, verbatim (zod v3's `.strict()` method used in place of
 * `z.strictObject`, which is a v4-only shorthand — the doc's own imports say
 * `npm:zod@3`). `.strict()` on every nested object: unknown fields fail
 * closed (FR-012).
 */

const ApprovalRuleSchema = z
	.object({
		role: z.enum([
			'reviewer',
			'scope-approver',
			'security-approver',
			'data-approver',
			'infra-approver',
			'org-governor'
		]),
		count: z.number().int().positive(),
		distinct_teams: z.boolean().optional()
	})
	.strict();

const ScopeRuleSchema = z
	.object({
		id: z.string(),
		match: z.array(z.string()), // glob pattern
		require: z
			.object({
				approvals: z.array(ApprovalRuleSchema),
				checks: z.array(z.string()).optional(),
				trusted_pipeline: z.boolean().optional(),
				prohibit_self_weakening: z.boolean().optional()
			})
			.strict()
	})
	.strict();

export const PolicySchema = z
	.object({
		version: z.literal('yoroi/v2'),
		defaults: z
			.object({
				gate_check: z.literal('yoroi/gate'),
				queue: z
					.object({
						mode: z.enum(['observe', 'advisory', 'serial', 'speculative', 'batch']),
						aging: z.string()
					})
					.strict(),
				approval_continuity: z
					.object({
						algorithm: z.literal('scope-change-v1'),
						whitespace: z.literal('exact'),
						context_proof: z.literal('deterministic-replay'),
						high_risk_base_overlap: z.enum(['reapprove', 'notify_only']),
						ambiguous: z.literal('invalidate-affected')
					})
					.strict(),
				draft: z.object({ candidate: z.literal('disabled'), checks: z.array(z.string()) }).strict(),
				questionnaire: z.object({ mode: z.literal('triggered') }).strict(),
				notifications: z.object({ mutable_summary: z.boolean(), coalesce: z.string() }).strict()
			})
			.strict(),
		scopes: z.array(ScopeRuleSchema),
		risk: z
			.record(
				z.string(),
				z
					.object({
						queue: z.object({ mode: z.string() }).strict(),
						prohibit_batch: z.boolean().optional()
					})
					.strict()
			)
			.optional(),
		self_service: z
			.object({
				recheck: z
					.object({
						enabled: z.boolean(),
						cooldown: z.string(),
						policy_mutation: z.literal(false)
					})
					.strict(),
				flaky_report: z
					.object({
						enabled: z.boolean(),
						quarantine_requires_approval: z.literal(true)
					})
					.strict()
			})
			.strict()
			.optional(),
		break_glass: z
			.object({
				approvals: z.number().int().min(2),
				distinct_actors: z.literal(true),
				max_ttl: z.string(),
				require_ticket: z.literal(true),
				require_post_review: z.literal(true)
			})
			.strict()
	})
	.strict();

export type PolicyDocument = z.infer<typeof PolicySchema>;
export type ScopeRule = z.infer<typeof ScopeRuleSchema>;
export type ApprovalRule = z.infer<typeof ApprovalRuleSchema>;
