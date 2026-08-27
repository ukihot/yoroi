import { controlApi } from '$lib/server/yoroi/control-api';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// TEMP: artificial delay to exercise the DownloadOverlay loading HUD.
	// Remove once done testing.
	await new Promise((resolve) => setTimeout(resolve, 4000));

	const queue = await controlApi.getMergeQueue();
	return { queue };
};
