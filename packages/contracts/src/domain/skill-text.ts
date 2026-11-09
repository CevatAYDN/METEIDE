const encoder = new TextEncoder();

/** Internal text validation preserves BOM and rejects NUL or unpaired surrogates. */
export const unicodeText = (text: string) =>
	!text.includes("\0") &&
	new TextDecoder("utf-8", { ignoreBOM: true }).decode(encoder.encode(text)) ===
		text;
