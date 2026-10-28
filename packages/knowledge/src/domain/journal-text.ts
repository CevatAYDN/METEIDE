// The workspace vault's daily notes (docs/11, Vaults): `journal/YYYY-MM-DD.md`, with the note
// frontmatter of docs/11 on the day's first section; each later section is appended to it.

const two = (n: number) => String(n).padStart(2, "0");

/** The local date of a moment, as the note's name. */
export const dayOf = (at: Date) =>
	`${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;

/** One section for the day's note; `source` names the first writer (`run/<id>` or `human`). */
export type JournalEntry = {
	readonly day: string;
	readonly source: string;
	readonly section: string;
};

const frontmatter = (day: string, now: string, source: string) =>
	[
		"---",
		"type: journal",
		`title: Journal ${day}`,
		`created: ${now}`,
		`updated: ${now}`,
		`source: ${source}`,
		"tags: []",
		"private: false",
		"pinned: false",
		"---",
		"",
		`# ${day}`,
		"",
	].join("\n");

/** The day's note with the entry appended; `was` is the note as it is, if it exists. */
export const journalText = (
	was: string | undefined,
	entry: JournalEntry,
	now: string,
) =>
	(was === undefined
		? frontmatter(entry.day, now, entry.source)
		: `${was.replace(/^updated: .*$/m, `updated: ${now}`).trimEnd()}\n\n`) +
	entry.section;
