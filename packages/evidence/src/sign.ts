import type { DecisionEnvelope } from "./envelope.ts";

/**
 * design.md §12.2. MVP: HMAC-SHA256 with a shared key (`importHmacSigningKey`
 * below). The doc's high-assurance config note ("Ed25519 + KMS sign-only")
 * only swaps what `signingKey`/`verifyKey` *are* — a `CryptoKey` from an
 * external KMS's sign-only handle instead of an imported raw secret — not
 * these two function signatures, so that swap needs no caller-visible change
 * later.
 */

function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeysDeep);
	if (value !== null && typeof value === "object") {
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
		}
		return sorted;
	}
	return value;
}

/** Canonical JSON encoding of the envelope — same sorted-keys approach as
 * packages/policy's policy-digest canonicalization, so signature verification
 * doesn't depend on incidental key order surviving JSON (de)serialization. */
export function toCanonicalEnvelopeJson(envelope: DecisionEnvelope): string {
	return JSON.stringify(sortKeysDeep(envelope));
}

function toDigestInput(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
	try {
		const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
			value.length + ((4 - (value.length % 4)) % 4),
			"=",
		);
		const binary = atob(padded);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
		return bytes;
	} catch {
		return null;
	}
}

/** Import a shared HMAC secret as a `CryptoKey` usable by both
 * `signEnvelope` (control side) and `verifyEnvelopeSignature` (merger side)
 * in the MVP shared-key configuration. */
export function importHmacEnvelopeKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

export async function signEnvelope(
	envelope: DecisionEnvelope,
	signingKey: CryptoKey,
): Promise<string> {
	const material = new TextEncoder().encode(toCanonicalEnvelopeJson(envelope));
	const signature = await crypto.subtle.sign("HMAC", signingKey, toDigestInput(material));
	return bytesToBase64Url(new Uint8Array(signature));
}

/** Timing-safe via `crypto.subtle.verify` (never reconstruct-and-compare). */
export async function verifyEnvelopeSignature(
	envelope: DecisionEnvelope,
	signatureB64: string,
	verifyKey: CryptoKey,
): Promise<boolean> {
	const signatureBytes = base64UrlToBytes(signatureB64);
	if (!signatureBytes) return false;
	const material = new TextEncoder().encode(toCanonicalEnvelopeJson(envelope));
	return await crypto.subtle.verify(
		"HMAC",
		verifyKey,
		toDigestInput(signatureBytes),
		toDigestInput(material),
	);
}
