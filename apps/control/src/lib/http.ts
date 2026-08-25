/** design.md §16.1 ApiErrorBody — the machine/human-readable error shape every API error uses. */
export interface ApiErrorBody {
	code: string;
	humanReason: string;
	evidenceLink: string | null;
	selfServiceAction: string | null;
	escalationTo: string | null;
}

export function json(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), {
		...init,
		headers: { "content-type": "application/json; charset=utf-8", ...(init?.headers ?? {}) },
	});
}

export function apiError(status: number, body: ApiErrorBody): Response {
	return json(body, { status });
}

export function notFound(what: string): Response {
	return apiError(404, {
		code: "NOT_FOUND",
		humanReason: `${what} was not found`,
		evidenceLink: null,
		selfServiceAction: null,
		escalationTo: null,
	});
}

export function badRequest(humanReason: string): Response {
	return apiError(400, {
		code: "BAD_REQUEST",
		humanReason,
		evidenceLink: null,
		selfServiceAction: null,
		escalationTo: null,
	});
}
