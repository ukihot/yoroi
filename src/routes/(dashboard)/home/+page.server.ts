import { controlApi } from '$lib/server/yoroi/control-api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [overview, blocked] = await Promise.all([
		controlApi.getFleetOverview(),
		controlApi.getBlockedEntries()
	]);
	return { overview, blocked };
};
