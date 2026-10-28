import { posix } from "node:path";
import { type NoteType, NoteTypeSchema } from "@mete/contracts";
import { CHUNK_CHARS } from "../defaults.js";

// How a vault note becomes rows of the keyword index, and a query an FTS5 match (docs/11, Hybrid
// search; ADR-149).

/** One heading section of a note, or a piece of one over CHUNK_CHARS. */
export type Section = { readonly heading?: string; readonly text: string };

/** What the index keeps of a note besides its sections. */
export type NoteFacts = { readonly title: string; readonly type: NoteType };

const HEADING = /^#{1,6}[ \t]+(.+?)[ \t#]*$/;
const FENCE = /^[ \t]*(```|~~~)/;
const H1 = /^#[ \t]+(.+?)[ \t#]*$/m;

const TYPE_OF_FOLDER: Readonly<Record<string, NoteType>> = {
	decisions: "decision",
	lessons: "lesson",
	entities: "entity",
	journal: "journal",
	inbox: "inbox",
};

// Pieces of at most CHUNK_CHARS characters, each cut at its last line break when it has one.
const piecesOf = (text: string) => {
	const pieces: string[] = [];
	let rest = text;
	while (rest.length > CHUNK_CHARS) {
		const cut = rest.lastIndexOf("\n", CHUNK_CHARS);
		const at = cut > 0 ? cut : CHUNK_CHARS;
		pieces.push(rest.slice(0, at));
		rest = rest.slice(cut > 0 ? at + 1 : at);
	}
	return [...pieces, rest];
};

/** A note's body as its heading sections; a `#` inside a fenced block is no heading. */
export const sectionsOf = (body: string): Section[] => {
	const sections: { heading?: string; lines: string[] }[] = [{ lines: [] }];
	let fenced = false;
	for (const line of body.split(/\r?\n/)) {
		if (FENCE.test(line)) fenced = !fenced;
		const heading = fenced ? undefined : HEADING.exec(line)?.[1];
		if (heading) sections.push({ heading, lines: [] });
		else sections.at(-1)?.lines.push(line);
	}
	return sections.flatMap(({ heading, lines }) => {
		const text = lines.join("\n").trim();
		if (!heading && text === "") return [];
		return piecesOf(text).map((t) =>
			heading ? { heading, text: t } : { text: t },
		);
	});
};

/** A note's title and type; undefined for a note the index leaves out (private, or of no type). */
export const noteFacts = (
	path: string,
	data: Readonly<Record<string, unknown>>,
	body: string,
): NoteFacts | undefined => {
	if (data.private === true) return undefined;
	const typed = NoteTypeSchema.safeParse(data.type);
	const type = typed.success
		? typed.data
		: TYPE_OF_FOLDER[path.split("/")[0] ?? ""];
	if (!type) return undefined;
	const given = typeof data.title === "string" ? data.title.trim() : "";
	const title = given || (H1.exec(body)?.[1] ?? posix.basename(path, ".md"));
	return { title, type };
};

/** Each word of the query as an FTS5 phrase; undefined when it holds no letter or digit. */
export const ftsQuery = (query: string) =>
	/[\p{L}\p{N}]/u.test(query)
		? query
				.trim()
				.split(/\s+/)
				.map((w) => `"${w.replaceAll('"', '""')}"`)
				.join(" ")
		: undefined;
