import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { createApp } from "./app.ts";

/**
 * Only exercises paths that never reach a DB-touching route handler
 * (the auth gate, /healthz, and 404 fallthrough) — the route handlers
 * themselves talk to Postgres via the module-level `db` client and are
 * covered by `deno check` + manual verification against a real database
 * (see apps/control/README.md), not by these unit tests.
 */
async function withToken(token: string, fn: () => Promise<void>): Promise<void> {
	using _stub = stub(
		Deno.env,
		"get",
		(key: string) => (key === "YOROI_CONTROL_API_TOKEN" ? token : undefined),
	);
	await fn();
}

Deno.test("GET /healthz bypasses auth entirely", async () => {
	const app = createApp();
	const res = await app(new Request("http://localhost/healthz"));
	assertEquals(res.status, 200);
	assertEquals(await res.text(), "ok");
});

Deno.test("unauthenticated /api/* requests are rejected before any handler runs", async () => {
	await withToken("expected-secret", async () => {
		const app = createApp();
		const res = await app(new Request("http://localhost/api/health"));
		assertEquals(res.status, 401);
	});
});

Deno.test("an unknown path with valid auth falls through to 404", async () => {
	await withToken("expected-secret", async () => {
		const app = createApp();
		const res = await app(
			new Request("http://localhost/api/does-not-exist", {
				headers: { authorization: "Bearer expected-secret", "x-yoroi-actor-id": "alice" },
			}),
		);
		assertEquals(res.status, 404);
	});
});

Deno.test("a known path with an unsupported method falls through to 404", async () => {
	await withToken("expected-secret", async () => {
		const app = createApp();
		const res = await app(
			new Request("http://localhost/api/repos", {
				method: "DELETE",
				headers: { authorization: "Bearer expected-secret", "x-yoroi-actor-id": "alice" },
			}),
		);
		assertEquals(res.status, 404);
	});
});
