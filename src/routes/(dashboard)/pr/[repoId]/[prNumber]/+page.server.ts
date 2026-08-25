import { error, fail } from '@sveltejs/kit';
import { controlApi } from '$lib/server/yoroi/control-api';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const prNumber = Number(params.prNumber);
	const detail = await controlApi.getPrDecisionDetail(params.repoId, prNumber);
	if (!detail) error(404, 'pull request not found');
	return { detail };
};

export const actions: Actions = {
	/** design.md 15.2節・16章 `/api/pr/{repo}/{pr}/recheck` 相当。 */
	recheck: async ({ params }) => {
		const prNumber = Number(params.prNumber);
		const outcome = await controlApi.recheckPr(params.repoId, prNumber);
		return { recheck: outcome };
	},
	/** design.md 16章 `/api/pr/{repo}/{pr}/feedback` 相当。 */
	feedback: async ({ params, request }) => {
		const prNumber = Number(params.prNumber);
		const form = await request.formData();
		const description = String(form.get('description') ?? '').trim();
		if (!description) return fail(400, { feedback: 'missing' as const });
		await controlApi.submitFeedback(params.repoId, prNumber, description);
		return { feedback: 'submitted' as const };
	}
};
