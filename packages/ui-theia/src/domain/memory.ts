import { type NoteType, NoteTypeSchema } from "@mete/contracts";
import { parseDocument } from "yaml";
import { z } from "zod";

// The Memory screen's notes (docs/13, Knowledge; ADR-159): the workspace vault's notes with the
// title and type docs/11 gives the search index, their date, tags, source and private mark.

/** The vault's folder of each note type (docs/11, Vaults). */
export const NOTE_FOLDERS: Readonly<Record<string, NoteType>> = {
	decisions: "decision",
	lessons: "lesson",
	entities: "entity",
	journal: "journal",
	inbox: "inbox",
};

/** A note as the screen lists it; `path` is relative to the vault. */
export type MemoryNote = {
	readonly path: string;
	readonly type: NoteType;
	readonly title: string;
	/** ISO 8601: frontmatter `updated`, else `created`, else the file's time. */
	readonly at?: string;
	readonly tags: readonly string[];
	/** `run/<id>` or `human`, as the frontmatter says. */
	readonly source?: string;
	readonly private: boolean;
};

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const HEADING = /^#\s+(.+)$/m;
const Text = z.string().trim().min(1);

// Each field on its own, so one odd value leaves the rest of the note readable.
const field = <T>(schema: z.ZodType<T>, value: unknown) => {
	const r = schema.safeParse(value);
	return r.success ? r.data : undefined;
};

const splitFront = (
	text: string,
): { data: Readonly<Record<string, unknown>>; body: string } => {
	const m = FENCE.exec(text);
	if (!m) return { data: {}, body: text };
	const doc = parseDocument(m[1] ?? "");
	const data =
		doc.errors.length === 0
			? field(z.record(z.string(), z.unknown()), doc.toJS())
			: undefined;
	return { data: data ?? {}, body: text.slice(m[0].length) };
};

const fileTitle = (path: string) =>
	(path.split("/").pop() ?? path).replace(/\.md$/i, "");

/** The note at a vault path; undefined for a note with no type, which the index leaves out too. */
export const noteOf = (
	path: string,
	text: string,
	mtime?: number,
): MemoryNote | undefined => {
	const { data, body } = splitFront(text);
	const type =
		field(NoteTypeSchema, data.type) ?? NOTE_FOLDERS[path.split("/")[0] ?? ""];
	if (!type) return undefined;
	const at =
		field(Text, data.updated) ??
		field(Text, data.created) ??
		(mtime === undefined ? undefined : new Date(mtime).toISOString());
	const source = field(Text, data.source);
	return {
		path,
		type,
		title:
			field(Text, data.title) ??
			HEADING.exec(body)?.[1]?.trim() ??
			fileTitle(path),
		...(at === undefined ? {} : { at }),
		tags: field(z.array(Text), data.tags) ?? [],
		...(source === undefined ? {} : { source }),
		private: data.private === true,
	};
};

const timeOf = (n: MemoryNote) => (n.at ? Date.parse(n.at) : Number.NaN);

/** Newest first; a note without a readable date goes last. */
export const sortNotes = <T extends MemoryNote>(notes: readonly T[]): T[] =>
	[...notes].sort((a, b) => {
		const [x, y] = [timeOf(a), timeOf(b)];
		if (Number.isNaN(x)) return Number.isNaN(y) ? 0 : 1;
		return Number.isNaN(y) ? -1 : y - x;
	});

/** How many notes of each type, every type present. */
export const typeCounts = (notes: readonly MemoryNote[]) => {
	const counts = Object.fromEntries(
		NoteTypeSchema.options.map((t) => [t, 0]),
	) as Record<NoteType, number>;
	for (const n of notes) counts[n.type] += 1;
	return counts;
};
