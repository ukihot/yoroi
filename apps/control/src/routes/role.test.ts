import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { handleRole } from "./role.ts";

async function roleWithEnv(value: string | undefined) {
	using _stub = stub(
		Deno.env,
		"get",
		(key: string) => (key === "YOROI_DEFAULT_ROLE" ? value : undefined),
	);
	const res = await handleRole(
		new Request("http://localhost/api/role"),
		{ actorStableId: "alice" },
		{},
	);
	return await res.json();
}

Deno.test("handleRole defaults to operator when unset", async () => {
	assertEquals(await roleWithEnv(undefined), { role: "operator" });
});

Deno.test("handleRole passes through a known configured role", async () => {
	assertEquals(await roleWithEnv("maintainer"), { role: "maintainer" });
});

Deno.test("handleRole falls back to operator for an unrecognized value", async () => {
	assertEquals(await roleWithEnv("not-a-real-role"), { role: "operator" });
});
