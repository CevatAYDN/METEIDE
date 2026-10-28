import { z } from "zod";

// vault.read@1, vault.write@1 and lesson@1 from docs/11 (Vaults) and ADR-145; adapters return
// ToolError (tools.ts).

const text = z.string().trim().min(1);

/** Which vault; the personal one answers not_found until its folder is chosen (ADR-145). */
export const VaultScopeSchema = z.enum(["workspace", "personal"]);
export type VaultScope = z.infer<typeof VaultScopeSchema>;

/** Input of vault.read@1: a .md path relative to the vault. */
export const VaultReadInputSchema = z.strictObject({
	path: text,
	scope: VaultScopeSchema.default("workspace"),
});
export type VaultReadInput = z.input<typeof VaultReadInputSchema>;
/** The note as written. */
export type VaultReadOutput = {
	readonly path: string;
	readonly content: string;
};

/** Input of vault.write@1: the note types agents may write (docs/11, Writing rules). */
export const VaultWriteInputSchema = z.strictObject({
	type: z.enum(["lesson", "entity", "decision", "journal"]),
	title: text,
	body: text,
	tags: z.array(text).readonly().default([]),
	scope: VaultScopeSchema.default("workspace"),
});
export type VaultWriteInput = z.input<typeof VaultWriteInputSchema>;
/** created is false when an existing note was updated or the day's journal note appended to. */
export type VaultWriteOutput = {
	readonly path: string;
	readonly created: boolean;
};

/** lesson@1: what to do next time, what happened in the run that shows it, and its tags. */
export const LessonSchema = z.strictObject({
	title: text,
	lesson: text,
	evidence: text,
	tags: z.array(text).readonly().default([]),
});
export type Lesson = z.output<typeof LessonSchema>;
