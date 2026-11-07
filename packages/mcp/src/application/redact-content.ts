/** SDK-validated JSON objects retain their shape when secret-bearing strings are masked. */
export function redactWireValue(
	value: Record<string, unknown>,
	redact: (text: string) => string,
): Record<string, unknown>;
/** SDK-validated JSON values are masked before mapping, persistence or model visibility. */
export function redactWireValue(
	value: unknown,
	redact: (text: string) => string,
): unknown;
export function redactWireValue(
	value: unknown,
	redact: (text: string) => string,
): unknown {
	if (typeof value === "string") return redact(value);
	if (Array.isArray(value))
		return value.map((item) => redactWireValue(item, redact));
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				redact(key),
				redactWireValue(item, redact),
			]),
		);
	return value;
}
