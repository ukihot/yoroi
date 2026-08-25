import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** design.md 23.3節: Homeを既定ランディングページとする。 */
export const load: PageServerLoad = () => {
	return redirect(302, '/home');
};
