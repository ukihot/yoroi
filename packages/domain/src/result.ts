/**
 * design.md references `Result<T, E>` / `ok()` / `err()` throughout (§5.2,
 * §8, §9, ...) as the vocabulary for fail-closed decisions (SEC-018: a
 * function that returns `err` must never let the state machine advance
 * toward merge) but never spells out the type itself — this is that
 * definition, shared by every package.
 */
export type Result<T, E> =
	| { readonly ok: true; readonly value: T }
	| {
			readonly ok: false;
			readonly error: E;
	  };

export function ok<T>(value: T): Result<T, never> {
	return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
	return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
	return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
	return !result.ok;
}
