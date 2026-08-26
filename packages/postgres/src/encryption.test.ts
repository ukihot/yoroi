import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { decryptPayload, encryptPayload } from "./encryption.ts";

const KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

Deno.test("encryptPayload → decryptPayload round-trips", async () => {
	const plaintext = new TextEncoder().encode('{"action":"opened","pull_request":{"number":42}}');
	const encrypted = await encryptPayload(plaintext, KEY);
	const decrypted = await decryptPayload(encrypted, KEY);
	assertEquals(new TextDecoder().decode(decrypted), new TextDecoder().decode(plaintext));
});

Deno.test("同じplaintextでも毎回異なるciphertextになる（IVがランダム）", async () => {
	const plaintext = new TextEncoder().encode("same content");
	const a = await encryptPayload(plaintext, KEY);
	const b = await encryptPayload(plaintext, KEY);
	assertNotEquals(a, b);
});

Deno.test("違う鍵での復号は失敗する", async () => {
	const otherKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
	const encrypted = await encryptPayload(new TextEncoder().encode("secret"), KEY);
	await assertRejects(() => decryptPayload(encrypted, otherKey));
});
