import { controlApi } from '$lib/server/yoroi/control-api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const reviewerLoad = await controlApi.getReviewerLoad();
	return { reviewerLoad };
};
