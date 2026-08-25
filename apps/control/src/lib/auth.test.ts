import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { authenticate } from "./auth.ts";

/** Stubs Deno.env.get so `mustGetEnv('YOROI_CONTROL_API_TOKEN')` sees a
 * controlled value without touching real process env — per Deno's own
 * mocking/spying docs (https://docs.deno.com/runtime/test/mocking/). */
function withToken<T>(token: string, fn: () => T): T {
	using _stub = stub(
		Deno.env,
		"get",
		(key: string) => (key === "YOROI_CONTROL_API_TOKEN" ? token : undefined),
	);
	return fn();
}

Deno.test("authenticate rejects a missing bearer token", () => {
	withToken("expected-secret", () => {
		const req = new Request("http://localhost/api/health", {
			headers: { "x-yoroi-actor-id": "alice" },
		});
		const result = authenticate(req);
		assertEquals(result.ok, false);
		if (!result.ok) assertEquals(result.response.status, 401);
	});
});

Deno.test("authenticate rejects a wrong bearer token", () => {
	withToken("expected-secret", () => {
		const req = new Request("http://localhost/api/health", {
			headers: { authorization: "Bearer wrong", "x-yoroi-actor-id": "alice" },
		});
		const result = authenticate(req);
		assertEquals(result.ok, false);
		if (!result.ok) assertEquals(result.response.status, 401);
	});
});

Deno.test("authenticate requires X-Yoroi-Actor-Id once the token matches", () => {
	withToken("expected-secret", () => {
		const req = new Request("http://localhost/api/health", {
			headers: { authorization: "Bearer expected-secret" },
		});
		const result = authenticate(req);
		assertEquals(result.ok, false);
		if (!result.ok) assertEquals(result.response.status, 400);
	});
});

Deno.test("authenticate accepts a matching token and forwards the actor id", () => {
	withToken("expected-secret", () => {
		const req = new Request("http://localhost/api/health", {
			headers: { authorization: "Bearer expected-secret", "x-yoroi-actor-id": "alice" },
		});
		const result = authenticate(req);
		assertEquals(result.ok, true);
		if (result.ok) assertEquals(result.actor.actorStableId, "alice");
	});
});
