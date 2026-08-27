import { assertEquals } from '@std/assert';
import { compilePolicy } from './compile.ts';
import { evaluate, type EvaluationInput, scopesForTouchedPaths } from './evaluate.ts';
import type { PolicyDocument } from './schema.ts';
import { actorStableId, scopeId } from '@yoroi/domain';
import type { CompiledPolicy } from './compile.ts';

function doc(): PolicyDocument {
	return {
		version: 'yoroi/v2',
		defaults: {
			gate_check: 'yoroi/gate',
			queue: { mode: 'serial', aging: 'p50-based' },
			approval_continuity: {
				algorithm: 'scope-change-v1',
				whitespace: 'exact',
				context_proof: 'deterministic-replay',
				high_risk_base_overlap: 'reapprove',
				ambiguous: 'invalidate-affected'
			},
			draft: { candidate: 'disabled', checks: [] },
			questionnaire: { mode: 'triggered' },
			notifications: { mutable_summary: true, coalesce: '10m' }
		},
		scopes: [
			{
				id: 'frontend',
				match: ['src/**', 'ui/**'],
				require: { approvals: [{ role: 'reviewer', count: 1 }] }
			},
			{
				id: 'payments',
				match: ['payments/**'],
				require: { approvals: [{ role: 'security-approver', count: 2 }] }
			}
		],
		break_glass: {
			approvals: 2,
			distinct_actors: true,
			max_ttl: '2h',
			require_ticket: true,
			require_post_review: true
		}
	};
}

async function policy(): Promise<CompiledPolicy> {
	const result = await compilePolicy(doc(), null, null);
	if (!result.ok) throw new Error('fixture policy failed to compile');
	return result.value;
}

function baseInput(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
	return {
		candidate: { touchedScopeIds: [scopeId('frontend')], isDraft: false },
		approvals: [
			{
				scopeId: scopeId('frontend'),
				role: 'reviewer',
				actorStableId: actorStableId('u1'),
				maintained: true
			}
		],
		checks: [{ jobName: 'unit', required: true, conclusion: 'success', trustedRunner: true }],
		queue: { repoStatus: 'active' },
		...overrides
	};
}

Deno.test('evaluate: 承認・check・queueが全て満たされればPASS', async () => {
	const p = await policy();
	const result = evaluate(baseInput(), p);
	assertEquals(result.gateConclusion, 'PASS');
	assertEquals(result.reasonGraph.children.length, 0);
});

Deno.test('evaluate: 必要承認が不足していればBLOCKED、reason graphにG1が現れる', async () => {
	const p = await policy();
	const result = evaluate(baseInput({ approvals: [] }), p);
	assertEquals(result.gateConclusion, 'BLOCKED');
	assertEquals(
		result.reasonGraph.children.some((c) => c.label.includes('G1 Identity / Approval')),
		true
	);
});

Deno.test('evaluate: 必要承認数（quorum）に足りない場合もBLOCKED', async () => {
	const p = await policy();
	const result = evaluate(
		baseInput({
			candidate: { touchedScopeIds: [scopeId('payments')], isDraft: false },
			approvals: [
				{
					scopeId: scopeId('payments'),
					role: 'security-approver',
					actorStableId: actorStableId('u1'),
					maintained: true
				}
			]
		}),
		p
	);
	assertEquals(result.gateConclusion, 'BLOCKED');
});

Deno.test('evaluate: 失効した承認 (maintained=false) はcoverageに数えない', async () => {
	const p = await policy();
	const result = evaluate(
		baseInput({
			approvals: [
				{
					scopeId: scopeId('frontend'),
					role: 'reviewer',
					actorStableId: actorStableId('u1'),
					maintained: false
				}
			]
		}),
		p
	);
	assertEquals(result.gateConclusion, 'BLOCKED');
});

Deno.test('evaluate: 必須checkがpending中で承認・queueが問題なければPENDING', async () => {
	const p = await policy();
	const result = evaluate(
		baseInput({
			checks: [{ jobName: 'unit', required: true, conclusion: 'pending', trustedRunner: true }]
		}),
		p
	);
	assertEquals(result.gateConclusion, 'PENDING');
});

Deno.test(
	'evaluate: 必須checkが失敗していればBLOCKED（未起動・遅延も成功扱いしない, P-05）',
	async () => {
		const p = await policy();
		const result = evaluate(
			baseInput({
				checks: [{ jobName: 'unit', required: true, conclusion: 'failure', trustedRunner: true }]
			}),
			p
		);
		assertEquals(result.gateConclusion, 'BLOCKED');
	}
);

Deno.test('evaluate: 信頼できないrunnerでのsuccessは失敗扱いになる', async () => {
	const p = await policy();
	const result = evaluate(
		baseInput({
			checks: [{ jobName: 'unit', required: true, conclusion: 'success', trustedRunner: false }]
		}),
		p
	);
	assertEquals(result.gateConclusion, 'BLOCKED');
});

Deno.test('evaluate: Draft PRはcandidate対象外としてBLOCKED (FR-096)', async () => {
	const p = await policy();
	const result = evaluate(
		baseInput({ candidate: { touchedScopeIds: [scopeId('frontend')], isDraft: true } }),
		p
	);
	assertEquals(result.gateConclusion, 'BLOCKED');
});

Deno.test('evaluate: repoがpaused中はBLOCKED', async () => {
	const p = await policy();
	const result = evaluate(baseInput({ queue: { repoStatus: 'paused' } }), p);
	assertEquals(result.gateConclusion, 'BLOCKED');
});

Deno.test('scopesForTouchedPaths: globパターンに一致するscopeだけを返す', async () => {
	const p = await policy();
	const scopes = scopesForTouchedPaths(p, ['src/app.ts', 'payments/checkout.ts', 'README.md']);
	assertEquals(new Set(scopes), new Set([scopeId('frontend'), scopeId('payments')]));
});

Deno.test('scopesForTouchedPaths: 一致するpathがなければ空配列', async () => {
	const p = await policy();
	const scopes = scopesForTouchedPaths(p, ['README.md']);
	assertEquals(scopes.length, 0);
});
