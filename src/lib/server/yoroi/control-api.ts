import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import { controlApi as mockControlApi } from './mock-control-api';
import type {
	AuditEntry,
	BlockedEntry,
	ControlApiPort,
	FeedbackCase,
	FleetOverview,
	HealthEntry,
	MyWork,
	PrDecisionDetail,
	QueueEntry,
	RecheckOutcome,
	RepoDetail,
	RepoSummary
} from './types';

/**
 * Real `ControlApiPort` implementation: calls yoroi-control (design.md
 * 2.2節・16章・24.2節, `apps/control` in this repo) over HTTP instead of
 * returning `mock-control-api.ts`'s static sample data.
 *
 * Service-to-service auth is a shared bearer token plus a trusted
 * `X-Yoroi-Actor-Id` header carrying the actor Better Auth already
 * authenticated — a deliberate MVP stand-in for design.md 17.4節/24.4節's
 * full org SSO/OIDC federation between the two apps (see
 * `apps/control/src/lib/auth.ts`). `getRequestEvent()` (already used the
 * same way in `src/lib/server/auth.ts`) lets every existing call site keep
 * calling `controlApi.getX()` with no signature change: the actor comes
 * from the current request instead of being threaded through as a
 * parameter.
 */
function createHttpControlApi(baseUrl: string, apiToken: string): ControlApiPort {
	async function request<T>(
		path: string,
		init?: RequestInit
	): Promise<{ status: number; body: T | null }> {
		const event = getRequestEvent();
		const actorStableId = event.locals.user?.id ?? 'anonymous';
		const res = await event.fetch(`${baseUrl}${path}`, {
			...init,
			headers: {
				authorization: `Bearer ${apiToken}`,
				'x-yoroi-actor-id': actorStableId,
				...(init?.body ? { 'content-type': 'application/json' } : {}),
				...init?.headers
			}
		});
		if (res.status === 404) return { status: 404, body: null };
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(
				`yoroi-control ${init?.method ?? 'GET'} ${path} failed: ${res.status} ${text}`
			);
		}
		return { status: res.status, body: (await res.json()) as T };
	}

	async function get<T>(path: string): Promise<T> {
		const { body } = await request<T>(path);
		if (body === null) throw new Error(`yoroi-control GET ${path} returned no body`);
		return body;
	}

	async function getOrNull<T>(path: string): Promise<T | null> {
		const { body } = await request<T>(path);
		return body;
	}

	return {
		getFleetOverview: () => get<FleetOverview>('/api/fleet/overview'),
		getBlockedEntries: () => get<BlockedEntry[]>('/api/fleet/blocked'),
		getMyWork: () => get<MyWork>('/api/my-work'),
		listRepos: () => get<RepoSummary[]>('/api/repos'),
		getRepoDetail: (repoId) => getOrNull<RepoDetail>(`/api/repos/${encodeURIComponent(repoId)}`),
		getMergeQueue: () => get<QueueEntry[]>('/api/queue'),
		getPrDecisionDetail: (repoId, prNumber) =>
			getOrNull<PrDecisionDetail>(`/api/pr/${encodeURIComponent(repoId)}/${prNumber}`),
		getHealth: () => get<HealthEntry[]>('/api/health'),
		searchAudit: (query) => get<AuditEntry[]>(`/api/audit?q=${encodeURIComponent(query)}`),
		async recheckPr(repoId, prNumber) {
			const { body } = await request<{ outcome: RecheckOutcome }>(
				`/api/pr/${encodeURIComponent(repoId)}/${prNumber}/recheck`,
				{ method: 'POST' }
			);
			return body?.outcome ?? 'unchanged';
		},
		async submitFeedback(repoId, prNumber, description) {
			const { body } = await request<FeedbackCase>(
				`/api/pr/${encodeURIComponent(repoId)}/${prNumber}/feedback`,
				{ method: 'POST', body: JSON.stringify({ description }) }
			);
			if (!body) throw new Error('yoroi-control returned no feedback case');
			return body;
		}
	};
}

function mustGetApiToken(): string {
	if (!env.YOROI_CONTROL_API_TOKEN) {
		throw new Error('YOROI_CONTROL_API_TOKEN must be set when YOROI_CONTROL_URL is configured');
	}
	return env.YOROI_CONTROL_API_TOKEN;
}

/**
 * The real adapter when `YOROI_CONTROL_URL` is configured; otherwise the
 * existing mock, so `npm run dev` keeps working with zero setup when
 * `apps/control` isn't running locally.
 */
export const controlApi: ControlApiPort = env.YOROI_CONTROL_URL
	? createHttpControlApi(env.YOROI_CONTROL_URL.replace(/\/$/, ''), mustGetApiToken())
	: mockControlApi;
