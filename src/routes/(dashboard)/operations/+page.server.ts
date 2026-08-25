import { controlApi } from '$lib/server/yoroi/control-api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const health = await controlApi.getHealth();
	return { health };
};
