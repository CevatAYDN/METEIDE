import type { FsReadOutput } from "@mete/contracts";
import { BINARY_SNIFF_BYTES, STREAM_MAX_CHARS } from "../defaults.js";

// Text rules shared by the file and shell tools (docs/10, Built-in tools).

/** The file's line ending; "none" for text without a line break. */
export const lineEnding = (text: string): FsReadOutput["lineEnding"] => {
	const crlf = text.split("\r\n").length - 1;
	const lf = text.split("\n").length - 1 - crlf;
	if (crlf === 0 && lf === 0) return "none";
	if (lf === 0) return "crlf";
	return crlf === 0 ? "lf" : "mixed";
};

/** A NUL byte in the first 8 KB marks a binary file. */
export const isBinary = (bytes: Uint8Array) =>
	bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);

/** Lines `start` to `end` (1-based, inclusive), each with its own line break. */
export const sliceLines = (text: string, start = 1, end = Infinity) => {
	const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
	return {
		content: lines.slice(start - 1, end).join(""),
		totalLines: lines.length,
	};
};

const count = (text: string, part: string) => text.split(part).length - 1;

/**
 * Replaces `oldStr` with `newStr`: exactly once unless `replaceAll`. A CRLF file is
 * matched with LF endings and written back with CRLF; a mixed file is matched raw.
 */
export const editText = (
	text: string,
	edit: { oldStr: string; newStr: string; replaceAll?: boolean },
): { text: string; replacements: number } | { count: number } => {
	const crlf = lineEnding(text) === "crlf";
	const lf = (s: string) => (crlf ? s.replaceAll("\r\n", "\n") : s);
	const body = lf(text);
	const oldStr = lf(edit.oldStr);
	const n = count(body, oldStr);
	if (n === 0 || (n > 1 && !edit.replaceAll)) return { count: n };
	const out = body.split(oldStr).join(lf(edit.newStr));
	return { text: crlf ? out.replaceAll("\n", "\r\n") : out, replacements: n };
};

/** Keeps the first and last half of a long stream with a line naming the cut. */
export const cutStream = (text: string, max = STREAM_MAX_CHARS) => {
	if (text.length <= max) return text;
	const half = Math.floor(max / 2);
	const cut = text.length - 2 * half;
	return `${text.slice(0, half)}\n[${cut} characters cut]\n${text.slice(-half)}`;
};
