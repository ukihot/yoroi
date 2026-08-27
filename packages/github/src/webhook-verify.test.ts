import { assertEquals } from '@std/assert';
import { verifyHmacSignature } from './webhook-verify.ts';

async function sign(body: Uint8Array, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const buf = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
	const sig = await crypto.subtle.sign('HMAC', key, buf);
	return (
		'sha256=' +
		Array.from(new Uint8Array(sig))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('')
	);
}

Deno.test('verifyHmacSignature: 正しい署名は受理される', async () => {
	const body = new TextEncoder().encode('{"action":"opened"}');
	const sig = await sign(body, 'my-secret');
	assertEquals(await verifyHmacSignature(body, sig, 'my-secret'), true);
});

Deno.test('verifyHmacSignature: 改ざんされたbodyは拒否される', async () => {
	const body = new TextEncoder().encode('{"action":"opened"}');
	const sig = await sign(body, 'my-secret');
	const tampered = new TextEncoder().encode('{"action":"closed"}');
	assertEquals(await verifyHmacSignature(tampered, sig, 'my-secret'), false);
});

Deno.test('verifyHmacSignature: 違うsecretで作られた署名は拒否される', async () => {
	const body = new TextEncoder().encode('{"action":"opened"}');
	const sig = await sign(body, 'wrong-secret');
	assertEquals(await verifyHmacSignature(body, sig, 'my-secret'), false);
});

Deno.test('verifyHmacSignature: sha256=プレフィックスがなければ即拒否', async () => {
	const body = new TextEncoder().encode('x');
	assertEquals(await verifyHmacSignature(body, 'deadbeef', 'secret'), false);
});

Deno.test('verifyHmacSignature: signatureHeaderがnullなら拒否', async () => {
	const body = new TextEncoder().encode('x');
	assertEquals(await verifyHmacSignature(body, null, 'secret'), false);
});

Deno.test('verifyHmacSignature: 不正な16進文字列は拒否', async () => {
	const body = new TextEncoder().encode('x');
	assertEquals(await verifyHmacSignature(body, 'sha256=not-hex!!', 'secret'), false);
});
