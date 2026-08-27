import { assertEquals } from '@std/assert';
import { checkOidcClaims, type OidcClaims, type OidcVerifyExpectation } from './identity-issuer.ts';

function claims(overrides: Partial<OidcClaims> = {}): OidcClaims {
	return {
		audience: 'yoroi-merger',
		issuer: 'https://deno.com',
		expiresAt: new Date(Date.now() + 60_000),
		org: 'acme',
		app: 'yoroi-control',
		context: 'production',
		...overrides
	};
}

const expected: OidcVerifyExpectation = {
	audience: 'yoroi-merger',
	allowedCallerApp: 'yoroi-control',
	requiredContext: 'production'
};

Deno.test('checkOidcClaims: 全て一致すればokを返す (SEC-034)', () => {
	const result = checkOidcClaims(claims(), expected);
	assertEquals(result.ok, true);
});

Deno.test('checkOidcClaims: 期限切れはEXPIRED', () => {
	const result = checkOidcClaims(claims({ expiresAt: new Date(Date.now() - 1) }), expected);
	assertEquals(result.ok, false);
	if (result.ok) return;
	assertEquals(result.error.kind, 'EXPIRED');
});

Deno.test('checkOidcClaims: audienceが違えばAUDIENCE_MISMATCH', () => {
	const result = checkOidcClaims(claims({ audience: 'wrong-audience' }), expected);
	assertEquals(result.ok, false);
	if (result.ok) return;
	assertEquals(result.error.kind, 'AUDIENCE_MISMATCH');
});

Deno.test(
	'checkOidcClaims: 呼び出し元appが違えばWRONG_APP (dev-revisionトークンの悪用防止)',
	() => {
		const result = checkOidcClaims(claims({ app: 'yoroi-console' }), expected);
		assertEquals(result.ok, false);
		if (result.ok) return;
		assertEquals(result.error.kind, 'WRONG_APP');
	}
);

Deno.test(
	'checkOidcClaims: contextがproductionでなければWRONG_CONTEXT (SEC-034: dev/branch tokenの拒否)',
	() => {
		const result = checkOidcClaims(claims({ context: 'development' }), expected);
		assertEquals(result.ok, false);
		if (result.ok) return;
		assertEquals(result.error.kind, 'WRONG_CONTEXT');
	}
);

Deno.test('checkOidcClaims: ちょうど期限と同時刻はEXPIRED扱い（境界は安全側）', () => {
	const now = new Date();
	const result = checkOidcClaims(claims({ expiresAt: now }), expected, now);
	assertEquals(result.ok, false);
});
