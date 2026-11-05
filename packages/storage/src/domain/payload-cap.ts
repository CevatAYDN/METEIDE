// Caps a persisted event's payload JSON (docs/07-domain-model-and-events.md, Persisted events).

/** What a cut payload becomes in the events table: the size it had and the start of its JSON. */
export type CutPayload = {
	readonly cut: true;
	readonly bytes: number;
	readonly head: string;
};

const byteLength = (s: string) => Buffer.byteLength(s, "utf8");

const marker = (bytes: number, head: string) =>
	JSON.stringify({ cut: true, bytes, head } satisfies CutPayload);

/**
 * Serializes a payload; when its UTF-8 JSON exceeds maxBytes, the result is a CutPayload marker
 * whose head is the longest prefix of the original JSON that keeps the marker under maxBytes.
 * The result always parses as JSON.
 */
export const capPayload = (
	payload: unknown,
	maxBytes: number,
): { json: string; cut: boolean } => {
	const json = JSON.stringify(payload);
	const bytes = byteLength(json);
	if (bytes <= maxBytes) return { json, cut: false };
	// Each character weighs at least one byte once escaped, so dropping as many characters as
	// bytes over the limit never undershoots by more than one round.
	let chars = Math.max(0, maxBytes - byteLength(marker(bytes, "")));
	let out = marker(bytes, json.slice(0, chars));
	while (chars > 0 && byteLength(out) > maxBytes) {
		chars = Math.max(0, chars - (byteLength(out) - maxBytes));
		out = marker(bytes, json.slice(0, chars));
	}
	return { json: out, cut: true };
};

/** Whether a stored payload is the marker capPayload leaves for a payload it cut. */
export const isCutPayload = (value: unknown): value is CutPayload =>
	typeof value === "object" &&
	value !== null &&
	(value as { cut?: unknown }).cut === true &&
	typeof (value as { bytes?: unknown }).bytes === "number" &&
	typeof (value as { head?: unknown }).head === "string";
