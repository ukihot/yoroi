/**
 * design.md §6.3 / FR-002: raw webhook payloads persisted for a short TTL
 * must be encrypted. AES-256-GCM via Web Crypto, key from a Production
 * context secret (`WEBHOOK_PAYLOAD_ENCRYPTION_KEY`, 32 random bytes,
 * base64-encoded). IV is generated per-encryption and stored alongside the
 * ciphertext (standard AES-GCM practice — the IV isn't secret).
 */

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64Encode(bytes: Uint8Array): string {
	let binary = "";
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

function base64Decode(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function importKey(keyBase64: string): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", toArrayBuffer(base64Decode(keyBase64)), "AES-GCM", false, [
		"encrypt",
		"decrypt",
	]);
}

/** Returns base64(iv || ciphertext). */
export async function encryptPayload(plaintext: Uint8Array, keyBase64: string): Promise<string> {
	const key = await importKey(keyBase64);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = new Uint8Array(
		await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, toArrayBuffer(plaintext)),
	);
	const combined = new Uint8Array(iv.length + ciphertext.length);
	combined.set(iv, 0);
	combined.set(ciphertext, iv.length);
	return base64Encode(combined);
}

export async function decryptPayload(encoded: string, keyBase64: string): Promise<Uint8Array> {
	const key = await importKey(keyBase64);
	const combined = base64Decode(encoded);
	const iv = combined.slice(0, 12);
	const ciphertext = combined.slice(12);
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: toArrayBuffer(iv) },
		key,
		toArrayBuffer(ciphertext),
	);
	return new Uint8Array(plaintext);
}
