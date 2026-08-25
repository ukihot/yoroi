import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async (event) => {
		await auth.api.signOut({ headers: event.request.headers });
		return redirect(302, '/login');
	}
};
