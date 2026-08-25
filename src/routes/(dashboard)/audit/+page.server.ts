import { controlApi } from '$lib/server/yoroi/control-api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const query = url.searchParams.get('q') ?? '';
	const results = await controlApi.searchAudit(query);
	return { query, results };
};
