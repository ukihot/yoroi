import { error, fail } from '@sveltejs/kit';
import { controlApi } from '$lib/server/yoroi/control-api';
import { isOperatorOrAbove, resolveRole } from '$lib/server/yoroi/roles';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const repo = await controlApi.getRepoDetail(params.repoId);
	if (!repo) error(404, 'repository not found');
	return { repo };
};

/**
 * design.md 16章 `POST /api/repos/{id}/pause` / `drain`（operator + re-auth）相当。
 * yoroi-controlが無いため、権限チェックと入力検証のみ行い実際の状態は変えない。
 */
export const actions: Actions = {
	pause: async ({ locals, request }) => {
		if (!locals.user) return fail(401);
		const role = await resolveRole(locals.user.id);
		if (!isOperatorOrAbove(role)) return fail(403, { action: 'pause' as const });
		const formData = await request.formData();
		const reason = formData.get('reason')?.toString().trim();
		const ticket = formData.get('ticket')?.toString().trim();
		if (!reason || !ticket) return fail(400, { action: 'pause' as const });
		return { action: 'pause' as const, ok: true };
	},
	drain: async ({ locals, request }) => {
		if (!locals.user) return fail(401);
		const role = await resolveRole(locals.user.id);
		if (!isOperatorOrAbove(role)) return fail(403, { action: 'drain' as const });
		const formData = await request.formData();
		const reason = formData.get('reason')?.toString().trim();
		const ticket = formData.get('ticket')?.toString().trim();
		if (!reason || !ticket) return fail(400, { action: 'drain' as const });
		return { action: 'drain' as const, ok: true };
	}
};
