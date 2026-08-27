import { assertEquals } from '@std/assert';
import { buildReasonGraph } from './reason-graph.ts';
import { scopeId } from '@yoroi/domain';

const passingParts = {
	approvalResult: { pass: true, missing: [] },
	checkResult: { pass: true, pending: false, failedJobs: [], pendingJobs: [] },
	queueResult: { pass: true, reason: null }
};

Deno.test('buildReasonGraph: 全て合格していれば子を持たない「Merge可能」', () => {
	const graph = buildReasonGraph(passingParts);
	assertEquals(graph.label, 'Merge可能');
	assertEquals(graph.children.length, 0);
});

Deno.test('buildReasonGraph: 承認不足はG1ノードとして不足数を表示する', () => {
	const graph = buildReasonGraph({
		...passingParts,
		approvalResult: {
			pass: false,
			missing: [{ scopeId: scopeId('payments'), role: 'security-approver', have: 0, need: 2 }]
		}
	});
	assertEquals(graph.label, 'Merge不可');
	const g1 = graph.children.find((c) => c.label.includes('G1 Identity / Approval'));
	assertEquals(g1 !== undefined, true);
	assertEquals(g1?.children[0]?.label, 'payments scopeのsecurity-approver承認が2件不足');
});

Deno.test('buildReasonGraph: check失敗・pendingはG3ノードに列挙される', () => {
	const graph = buildReasonGraph({
		...passingParts,
		checkResult: { pass: false, pending: false, failedJobs: ['unit'], pendingJobs: ['e2e'] }
	});
	const g3 = graph.children.find((c) => c.label.includes('G3 Test Evidence'));
	assertEquals(g3 !== undefined, true);
	assertEquals(
		g3?.children.map((c) => c.label),
		['unitが失敗', 'e2e実行中']
	);
});

Deno.test('buildReasonGraph: queue不合格はreasonをそのままノードにする', () => {
	const graph = buildReasonGraph({
		...passingParts,
		queueResult: { pass: false, reason: 'repoがpaused中です' }
	});
	assertEquals(
		graph.children.some((c) => c.label === 'repoがpaused中です'),
		true
	);
});

Deno.test('buildReasonGraph: 複数gateが同時に不合格なら複数の子ノードを持つ', () => {
	const graph = buildReasonGraph({
		approvalResult: {
			pass: false,
			missing: [{ scopeId: scopeId('frontend'), role: 'reviewer', have: 0, need: 1 }]
		},
		checkResult: { pass: false, pending: false, failedJobs: ['unit'], pendingJobs: [] },
		queueResult: { pass: true, reason: null }
	});
	assertEquals(graph.children.length, 2);
});
