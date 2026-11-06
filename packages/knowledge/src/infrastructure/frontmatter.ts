import { parseDocument, stringify } from "yaml";

// A note's frontmatter (docs/11, Vaults): the YAML map between the note's first two `---` lines.

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** A note split into its frontmatter and its body. */
export type NoteParts = {
	readonly data: Readonly<Record<string, unknown>>;
	readonly body: string;
};

const isMap = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** The note's frontmatter and body; undefined for an unclosed fence or anything but a YAML map. */
export const splitNote = (text: string): NoteParts | undefined => {
	const view = text.startsWith("\uFEFF") ? text.slice(1) : text;
	const m = FENCE.exec(view);
	if (!m)
		return /^---(?:\r?\n|$)/.test(view) ? undefined : { data: {}, body: text };
	const doc = parseDocument(m[1] ?? "");
	const data: unknown = doc.errors.length === 0 ? doc.toJS() : undefined;
	return isMap(data) ? { data, body: view.slice(m[0].length) } : undefined;
};

/** A note as text: its frontmatter, then its body. */
export const noteText = (
	data: Readonly<Record<string, unknown>>,
	body: string,
) => `---\n${stringify(data)}---\n\n${body.trim()}\n`;
