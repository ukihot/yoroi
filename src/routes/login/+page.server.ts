import { fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) return redirect(302, '/home');
	return {};
};

export const actions: Actions = {
	signInGithub: async (event) => {
		const result = await auth.api.signInSocial({
			body: { provider: 'github', callbackURL: '/home' }
		});
		if (result.url) return redirect(302, result.url);
		return fail(400, { message: 'sign-in failed' });
	}
};
