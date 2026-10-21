// Retry-After (RFC 9110, section 10.2.3): delay seconds or an HTTP date (docs/09, observe() rules).

// The latest time a Date can hold (ECMA-262, time values); beyond it toISOString throws.
const MAX_TIME = 8.64e15;

/** The reset time a Retry-After header names, as ISO 8601; undefined when absent, unreadable, past or out of range. */
// A past reset would make the caller retry at once, which docs/09 forbids.
export const retryAfter = (
	headers: Headers,
	now: number,
): string | undefined => {
	const value = headers.get("retry-after")?.trim();
	if (!value) return undefined;
	const at = /^\d+$/.test(value)
		? now + Number(value) * 1000
		: Date.parse(value);
	return at > now && at <= MAX_TIME ? new Date(at).toISOString() : undefined;
};
