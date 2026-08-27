import { assertEquals } from '@std/assert';
import { classifyResponsibility, type ClassifyResponsibilityInput } from './dashboard-taxonomy.ts';
import type { ReasonGraphNode } from '@yoroi/policy';

function input(overrides: Partial<ClassifyResponsibilityInput> = {}): ClassifyResponsibilityInput {
	return {
		gateConclusion: 'BLOCKED',
		reasonGraph: { label: 'Merge不可', children: [] },
		isAuthor: false,
		githubApiDegraded: false,
		...overrides
	};
}

Deno.test('classifyResponsibility: PASSはyoroi_internal扱い', () => {
	assertEquals(classifyResponsibility(input({ gateConclusion: 'PASS' })), 'yoroi_internal');
});

Deno.test('classifyResponsibility: GitHub API degraded中はgithub_outage', () => {
	assertEquals(classifyResponsibility(input({ githubApiDegraded: true })), 'github_outage');
});

Deno.test('classifyResponsibility: G1不足でauthor視点はyour_action', () => {
	const graph: ReasonGraphNode = {
		label: 'Merge不可',
		children: [{ label: 'G1 Identity / Approval未成立', children: [] }]
	};
	assertEquals(
		classifyResponsibility(input({ reasonGraph: graph, isAuthor: true })),
		'your_action'
	);
});

Deno.test('classifyResponsibility: G1不足でreviewer視点はother_reviewer', () => {
	const graph: ReasonGraphNode = {
		label: 'Merge不可',
		children: [{ label: 'G1 Identity / Approval未成立', children: [] }]
	};
	assertEquals(
		classifyResponsibility(input({ reasonGraph: graph, isAuthor: false })),
		'other_reviewer'
	);
});

Deno.test('classifyResponsibility: G3未成立はci', () => {
	const graph: ReasonGraphNode = {
		label: 'Merge不可',
		children: [{ label: 'G3 Test Evidence未成立', children: [] }]
	};
	assertEquals(classifyResponsibility(input({ reasonGraph: graph })), 'ci');
});

Deno.test('classifyResponsibility: repoがpaused中はqueue', () => {
	const graph: ReasonGraphNode = {
		label: 'Merge不可',
		children: [{ label: 'repoがpaused中です', children: [] }]
	};
	assertEquals(classifyResponsibility(input({ reasonGraph: graph })), 'queue');
});

Deno.test('classifyResponsibility: draftのblockはauthorならyour_action', () => {
	const graph: ReasonGraphNode = {
		label: 'Merge不可',
		children: [{ label: 'draftのためcandidate対象外', children: [] }]
	};
	assertEquals(
		classifyResponsibility(input({ reasonGraph: graph, isAuthor: true })),
		'your_action'
	);
});

Deno.test('classifyResponsibility: 該当理由がなければneeds_investigation', () => {
	const graph: ReasonGraphNode = {
		label: 'Merge不可',
		children: [{ label: '不明な理由', children: [] }]
	};
	assertEquals(classifyResponsibility(input({ reasonGraph: graph })), 'needs_investigation');
});
