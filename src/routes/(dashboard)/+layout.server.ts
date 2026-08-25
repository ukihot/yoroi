import { redirect } from '@sveltejs/kit';
import { controlApi } from '$lib/server/yoroi/control-api';
import { resolveRole } from '$lib/server/yoroi/roles';
import type { LayoutServerLoad } from './$types';

/**
 * design.md 24.4節: 認証はBetter Auth（`hooks.server.ts`で既に検証済み）に委ね、
 * ロールは（将来）yoroi-control側で解決させる。UI側のガードはUXのためであり、
 * 実際のmutation権限は各endpointが個別に再検証する。
 */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		return redirect(302, `/login?next=${encodeURIComponent(url.pathname)}`);
	}

	const [role, blocked] = await Promise.all([resolveRole(locals.user.id), controlApi.getBlockedEntries()]);

	return {
		user: { id: locals.user.id, name: locals.user.name },
		role,
		needsAttentionCount: blocked.filter((b) => b.responsibility === 'your_action').length
	};
};
