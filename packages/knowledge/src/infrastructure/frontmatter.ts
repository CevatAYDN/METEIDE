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

/** The note's frontmatter and body; undefined when its frontmatter is not a YAML map. */
export const splitNote = (text: string): NoteParts | undefined => {
	const m = FENCE.exec(text);
	if (!m) return { data: {}, body: text };
	const doc = parseDocument(m[1] ?? "");
	const data: unknown = doc.errors.length === 0 ? doc.toJS() : undefined;
	return isMap(data) ? { data, body: text.slice(m[0].length) } : undefined;
};

/** A note as text: its frontmatter, then its body. */
export const noteText = (
	data: Readonly<Record<string, unknown>>,
	body: string,
) => `---\n${stringify(data)}---\n\n${body.trim()}\n`;
