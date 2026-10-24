import { err, ok, type Result } from "@mete/contracts";
import { isMap, type parseDocument } from "yaml";
import type { z } from "zod";

// The Settings files' sections as YAML documents (ADR-082, ADR-096, ADR-097): a section is set and
// removed in place, so the file's comments and the keys a card does not show stay.

/** A parsed file. */
export type Doc = ReturnType<typeof parseDocument>;

/** Whether the document sets any key; a missing, empty or comment-only file sets none. */
export const isEmpty = (doc: Doc) =>
	doc.contents === null ||
	(isMap(doc.contents) && doc.contents.items.length === 0);

/** The section's node, or the whole document's when the file holds the map itself. */
export const at = (doc: Doc, prefix: readonly string[]) =>
	prefix.length === 0 ? doc.contents : doc.getIn(prefix, true);

/** The first issue of a failed parse, in the schema's words. */
export const reasonOf = (error: z.ZodError) =>
	error.issues[0]?.message ?? "invalid";

/** The first issue as the file's path and the schema's words. */
export const issueText = (error: z.ZodError, path: readonly string[]) => {
	const issue = error.issues[0];
	const where = [...path, ...(issue?.path ?? [])].map(String).join(".");
	return `${where || "config"}: ${reasonOf(error)}`;
};

// The section as a map: an absent one is created when asked, and a value that is not a map is
// refused.
export const sectionOf = (
	doc: Doc,
	prefix: readonly string[],
	create: boolean,
): Result<unknown, string> => {
	const current = at(doc, prefix);
	if (current === undefined || current === null) {
		if (!create) return ok(undefined);
		// createNode, since setIn takes a plain object for a scalar (yaml 2).
		doc.setIn(prefix, doc.createNode({}));
		return ok(at(doc, prefix));
	}
	if (!isMap(current))
		return err(`${prefix.join(".") || "config"}: expected a map`);
	return ok(current);
};

/** A section the card emptied goes, so the file sets nothing rather than an empty map. */
export const dropSection = (
	doc: Doc,
	prefix: readonly string[],
	items: number,
) => {
	if (items > 0 || prefix.length === 0 || !doc.hasIn(prefix)) return;
	const node = at(doc, prefix);
	if (isMap(node) && node.items.length === 0) doc.deleteIn(prefix);
};
