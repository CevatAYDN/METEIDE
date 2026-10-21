/** The Node.js error code of a failed file operation, if any. */
export const errnoOf = (e: unknown): string | undefined =>
	e instanceof Error && "code" in e && typeof e.code === "string"
		? e.code
		: undefined;
