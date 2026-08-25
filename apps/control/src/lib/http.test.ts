import { assertEquals } from "@std/assert";
import { apiError, badRequest, json, notFound } from "./http.ts";

Deno.test("json sets the content-type header and serializes the body", async () => {
	const res = json({ hello: "world" }, { status: 201 });
	assertEquals(res.status, 201);
	assertEquals(res.headers.get("content-type"), "application/json; charset=utf-8");
	assertEquals(await res.json(), { hello: "world" });
});

Deno.test("apiError carries the ApiErrorBody shape through as JSON", async () => {
	const res = apiError(403, {
		code: "FORBIDDEN",
		humanReason: "nope",
		evidenceLink: null,
		selfServiceAction: null,
		escalationTo: "operator",
	});
	assertEquals(res.status, 403);
	assertEquals(await res.json(), {
		code: "FORBIDDEN",
		humanReason: "nope",
		evidenceLink: null,
		selfServiceAction: null,
		escalationTo: "operator",
	});
});

Deno.test("notFound and badRequest use the expected status/code", async () => {
	const nf = notFound("repository r9");
	assertEquals(nf.status, 404);
	assertEquals((await nf.json()).code, "NOT_FOUND");

	const br = badRequest("description is required");
	assertEquals(br.status, 400);
	const brBody = await br.json();
	assertEquals(brBody.code, "BAD_REQUEST");
	assertEquals(brBody.humanReason, "description is required");
});
