/** Outcome of an operation that can fail in an expected way (ADR-034). */
export type Result<T, E> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: E };

/** Wraps a success value. */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

/** Wraps an expected failure; `E` is a discriminated union with a `code` field. */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
