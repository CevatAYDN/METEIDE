// Retry-After (RFC 9110, section 10.2.3): delay seconds or an HTTP date (docs/09, observe() rules).

/** The reset time a Retry-After header names, as ISO 8601, or undefined when absent or unreadable. */
export const retryAfter = (
	headers: Headers,
	now: number,
): string | undefined => {
	const value = headers.get("retry-after")?.trim();
	if (!value) return undefined;
	const at = /^\d+$/.test(value)
		? now + Number(value) * 1000
		: Date.parse(value);
	return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
};
