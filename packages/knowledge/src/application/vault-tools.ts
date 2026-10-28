import {
	type EventsReadAdapter,
	err,
	type FsReadOutput,
	type FsWriteOutput,
	ok,
	type Result,
	type ToolAdapter,
	type ToolContext,
	type ToolError,
	VaultReadInputSchema,
	type VaultReadOutput,
	VaultWriteInputSchema,
	type VaultWriteOutput,
} from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";
import type { z } from "zod";
import { NEW_NOTES_PER_RUN } from "../defaults.js";
import { dayOf, journalText } from "../domain/journal-text.js";
import { FOLDERS, notePath, slugOf, VAULT } from "../domain/note.js";
import { noteText, splitNote } from "../infrastructure/frontmatter.js";

// vault.read@1 and vault.write@1 (docs/11, Vaults; ADR-145). Notes go through fs.read@1 and
// fs.write@1, so the policy, .meteignore and the audit apply as to any agent write.

type Out<T> = Promise<Result<T, ToolError>>;
type Write = z.output<typeof VaultWriteInputSchema>;

/** What the tools need from the vault module. */
export type VaultDeps = {
	readonly registry: CapabilityRegistry;
	/** Runs a write after the ones before it, so no two writes rewrite one note at once. */
	readonly serial: <T>(job: () => Promise<T>) => Promise<T>;
	/** Publishes vault.note.saved. */
	readonly saved: (ctx: ToolContext, path: string, noteType: string) => void;
	readonly now: () => string;
};

const bad = (message: string) => err<ToolError>({ code: "bad_input", message });
const NO_PERSONAL = err<ToolError>({
	code: "not_found",
	message: "No personal vault is set up yet; use the workspace vault",
});

// The workspace, never the task's worktree: a note written there would go to the task's branch.
const inWorkspace = ({ cwd: _cwd, ...rest }: ToolContext): ToolContext => rest;

const fsTool = <O>(deps: VaultDeps, ref: "fs.read@1" | "fs.write@1") => {
	const chain = deps.registry.resolve<ToolAdapter<unknown, O>>(ref);
	return chain.ok ? chain.value[0].impl : undefined;
};

// A workspace file's text, or undefined when there is none.
const readText = async (
	deps: VaultDeps,
	ctx: ToolContext,
	path: string,
): Out<string | undefined> => {
	const fs = fsTool<FsReadOutput>(deps, "fs.read@1");
	if (!fs) return err({ code: "io", message: "fs.read@1 is not active" });
	const r = await fs.run({ path }, ctx);
	if (r.ok) return ok(r.value.content);
	return r.error.code === "not_found" ? ok(undefined) : r;
};

const writeText = async (
	deps: VaultDeps,
	ctx: ToolContext,
	path: string,
	content: string,
): Out<void> => {
	const fs = fsTool<FsWriteOutput>(deps, "fs.write@1");
	if (!fs) return err({ code: "io", message: "fs.write@1 is not active" });
	const r = await fs.run({ path, content }, ctx);
	return r.ok ? ok(undefined) : r;
};

// The vault path a read names, or why it names none.
const pathToRead = (input: unknown): Result<string, ToolError> => {
	const i = VaultReadInputSchema.safeParse(input);
	if (!i.success) return bad(i.error.message);
	if (i.data.scope === "personal") return NO_PERSONAL;
	const path = notePath(i.data.path);
	return path
		? ok(path)
		: bad(`${i.data.path} is not a .md note inside the vault`);
};

/** vault.read@1: a note as written; a private one is never given to a model. */
export const readNote =
	(deps: VaultDeps) =>
	async (input: unknown, ctx: ToolContext): Out<VaultReadOutput> => {
		const at = pathToRead(input);
		if (!at.ok) return at;
		const path = at.value;
		const text = await readText(deps, inWorkspace(ctx), `${VAULT}/${path}`);
		if (!text.ok) return text;
		if (text.value === undefined)
			return err({ code: "not_found", message: `${path} is not in the vault` });
		const parts = splitNote(text.value);
		if (!parts) return bad(`${path} has a frontmatter that is not YAML`);
		if (parts.data.private === true)
			return err({ code: "ignored", message: `${path} is private` });
		return ok({ path, content: text.value });
	};

const sourceOf = (ctx: ToolContext) =>
	ctx.runId ? `run/${ctx.runId}` : "human";

// The run's new notes: the lesson, entity and decision notes it saved that name it as their source,
// from its persisted events, so a resumed run keeps its count.
const newNotes = async (deps: VaultDeps, ctx: ToolContext, runId: string) => {
	const reader = deps.registry.resolve<EventsReadAdapter>("events.read@1");
	if (!reader.ok) return 0;
	const paths = new Set(
		reader.value[0].impl
			.read(runId)
			.events.flatMap((e) =>
				e.type === "vault.note.saved" && e.payload.noteType !== "journal"
					? [e.payload.path]
					: [],
			),
	);
	let n = 0;
	for (const path of paths) {
		const text = await readText(deps, ctx, path);
		const source = text.ok && text.value && splitNote(text.value)?.data.source;
		if (source === `run/${runId}`) n += 1;
	}
	return n;
};

// A new note's text, or why the run may not write one more.
const created = async (
	deps: VaultDeps,
	ctx: ToolContext,
	note: Write,
): Out<string> => {
	if (ctx.runId && (await newNotes(deps, ctx, ctx.runId)) >= NEW_NOTES_PER_RUN)
		return bad(
			`This run has written ${NEW_NOTES_PER_RUN} new notes, the limit; update one of them by its title instead`,
		);
	const now = deps.now();
	const data = {
		type: note.type,
		title: note.title,
		created: now,
		updated: now,
		source: sourceOf(ctx),
		tags: [...note.tags],
		private: false,
		pinned: false,
	};
	return ok(noteText(data, note.body));
};

// shortcut: the same title stands in for the 0.85 similarity of docs/11, until embeddings come
// (ADR-144); its body is replaced, created and source are kept and the tags are merged.
const updated = (
	was: string,
	note: Write,
	now: string,
): Result<string, ToolError> => {
	const parts = splitNote(was);
	if (!parts) return bad("The note there has a frontmatter that is not YAML");
	const tags = Array.isArray(parts.data.tags) ? parts.data.tags : [];
	const data = {
		...parts.data,
		title: note.title,
		updated: now,
		tags: [...new Set([...tags.map(String), ...note.tags])],
	};
	return ok(noteText(data, note.body));
};

const saveNote = async (
	deps: VaultDeps,
	ctx: ToolContext,
	note: Write & { readonly path: string },
): Out<VaultWriteOutput> => {
	const was = await readText(deps, ctx, note.path);
	if (!was.ok) return was;
	const text =
		was.value === undefined
			? await created(deps, ctx, note)
			: updated(was.value, note, deps.now());
	if (!text.ok) return text;
	const written = await writeText(deps, ctx, note.path, text.value);
	if (!written.ok) return written;
	deps.saved(ctx, note.path, note.type);
	return ok({ path: note.path, created: was.value === undefined });
};

// An agent's journal note: a section of the day's note, after the run reports already in it.
const appendNote = async (
	deps: VaultDeps,
	ctx: ToolContext,
	note: Write,
): Out<VaultWriteOutput> => {
	const now = deps.now();
	const day = dayOf(new Date(now));
	const path = `${VAULT}/${FOLDERS.journal}/${day}.md`;
	const was = await readText(deps, ctx, path);
	if (!was.ok) return was;
	const section = `### ${note.title}\n\n${note.body.trim()}\n`;
	const text = journalText(
		was.value,
		{ day, source: sourceOf(ctx), section },
		now,
	);
	const written = await writeText(deps, ctx, path, text);
	if (!written.ok) return written;
	deps.saved(ctx, path, "journal");
	return ok({ path, created: was.value === undefined });
};

/** vault.write@1: a lesson, entity or decision note by its title, or a section of today's journal. */
export const writeNote =
	(deps: VaultDeps) =>
	async (input: unknown, ctx: ToolContext): Out<VaultWriteOutput> => {
		const i = VaultWriteInputSchema.safeParse(input);
		if (!i.success) return bad(i.error.message);
		if (i.data.scope === "personal") return NO_PERSONAL;
		const note = i.data;
		const at = inWorkspace(ctx);
		if (note.type === "journal")
			return deps.serial(() => appendNote(deps, at, note));
		const slug = slugOf(note.title);
		if (!slug) return bad("A note's title needs a letter or a digit");
		const path = `${VAULT}/${FOLDERS[note.type]}/${slug}.md`;
		return deps.serial(() => saveNote(deps, at, { ...note, path }));
	};
