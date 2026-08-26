/** design.md §19.1, verbatim. */
export async function verifyHmacSignature(
	rawBody: Uint8Array,
	signatureHeader: string | null,
	secret: string,
): Promise<boolean> {
	if (!signatureHeader?.startsWith("sha256=")) return false;
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		[
			"verify",
		],
	);
	const signatureBytes = hexToBytes(signatureHeader.slice("sha256=".length));
	if (!signatureBytes) return false;
	// crypto.subtle.verifyはHMAC検証を内部実装し、早期returnによるtiming leakを避ける設計になっている
	return crypto.subtle.verify("HMAC", key, toDigestInput(signatureBytes), toDigestInput(rawBody));
}

function hexToBytes(hex: string): Uint8Array | null {
	if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function toDigestInput(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
