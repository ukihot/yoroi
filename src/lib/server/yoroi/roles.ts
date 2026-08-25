import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import type { Role } from './types';

const KNOWN_ROLES: readonly Role[] = [
	'reviewer',
	'scope_approver',
	'security_approver',
	'data_approver',
	'infra_approver',
	'governor',
	'operator',
	'maintainer',
	'developer'
];

/**
 * design.md 24.4節: 「ロールはyoroi-control側で解決させ、consoleは結果を信頼するだけにする」。
 * `YOROI_CONTROL_URL`が設定されていればyoroi-controlの`GET /api/role`を呼び出し、
 * 未設定（バックエンド未起動のローカル開発等）なら従来どおり環境変数/固定値へfallbackする。
 */
export async function resolveRole(actorId: string): Promise<Role> {
	if (env.YOROI_CONTROL_URL) {
		try {
			const event = getRequestEvent();
			const res = await event.fetch(
				`${env.YOROI_CONTROL_URL.replace(/\/$/, '')}/api/role?actorId=${encodeURIComponent(actorId)}`,
				{
					headers: {
						authorization: `Bearer ${env.YOROI_CONTROL_API_TOKEN ?? ''}`,
						'x-yoroi-actor-id': actorId
					}
				}
			);
			if (res.ok) {
				const body = (await res.json()) as { role?: Role };
				if (body.role && KNOWN_ROLES.includes(body.role)) return body.role;
			}
		} catch (err) {
			console.error('resolveRole: yoroi-control request failed, falling back', err);
		}
	}

	const configured = env.YOROI_DEV_ROLE as Role | undefined;
	if (configured && KNOWN_ROLES.includes(configured)) return configured;
	return 'operator';
}

export function isOperatorOrAbove(role: Role): boolean {
	return role === 'operator' || role === 'governor';
}
