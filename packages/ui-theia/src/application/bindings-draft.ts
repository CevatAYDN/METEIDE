import { CapabilityRefSchema, err, ok, type Result } from "@mete/contracts";
import { isMap, parseDocument } from "yaml";
import { z } from "zod";
import { type Target, valueAt } from "./section-draft.js";
import {
	at,
	type Doc,
	dropSection,
	isEmpty,
	issueText,
	reasonOf,
	sectionOf,
} from "./yaml-section.js";

// The bindings form's file (ADR-096): `.mete/bindings.yaml` maps a capability id to its adapter ids
// in fallback order; the global `settings.yaml` holds the same map under `bindings`.

/** One row as the user typed it: the capability, and its adapters separated by commas. */
export type BindingsRow = {
	readonly capability: string;
	readonly adapters: string;
};

/** What the form edits. */
export type BindingsDraft = readonly BindingsRow[];

// ADR-045 keeps @mete/kernel out of the desktop, so this mirrors its BindingsSchema (ADR-096), with
// one stricter rule: a row with no adapter is refused, since it would bind the capability to nothing.
const BindingsSchema = z.record(
	z.string().pipe(CapabilityRefSchema),
	z.array(z.string().min(1)).min(1).readonly(),
);

const prefixOf = (target: Target) => (target === "global" ? ["bindings"] : []);

// The rows a file sets; a missing file sets none.
const rowsOf = (root: unknown): Result<BindingsDraft, string> => {
	if (root === undefined || root === null) return ok([]);
	if (typeof root !== "object" || Array.isArray(root))
		return err("bindings: expected a map of capabilities");
	const rows: BindingsRow[] = [];
	for (const [capability, adapters] of Object.entries(root)) {
		if (!Array.isArray(adapters))
			return err(`${capability}: expected a list of adapter ids`);
		rows.push({ capability, adapters: adapters.map(String).join(", ") });
	}
	return ok(rows);
};

/** The rows a file sets; a missing file sets none. */
export const bindingsOf = (
	text: string | undefined,
	target: Target,
): Result<BindingsDraft, string> => {
	const doc = parseDocument(text ?? "");
	const [first] = doc.errors;
	if (first) return err(first.message);
	return rowsOf(valueAt(doc.toJS(), prefixOf(target)));
};

// The adapters a row names, in order; a row with none is refused.
const adaptersOf = (
	capability: string,
	text: string,
): Result<readonly string[], string> => {
	const adapters = text
		.split(",")
		.map((adapter) => adapter.trim())
		.filter((adapter) => adapter !== "");
	return adapters.length === 0
		? err(`${capability}: a row needs at least one adapter`)
		: ok(adapters);
};

// One row as the map's entry: its id checked, its adapters parsed.
const rowOf = (
	row: BindingsRow,
): Result<readonly [string, readonly string[]], string> => {
	const capability = row.capability.trim();
	if (capability === "") return err("a row needs a capability id");
	const ref = CapabilityRefSchema.safeParse(capability);
	if (!ref.success) return err(`${capability}: ${reasonOf(ref.error)}`);
	const adapters = adaptersOf(capability, row.adapters);
	return adapters.ok ? ok([capability, adapters.value] as const) : adapters;
};

// The rows as the file's map, checked with the same rules as the kernel's schema.
const recordOf = (
	rows: BindingsDraft,
): Result<Record<string, readonly string[]>, string> => {
	const record: Record<string, readonly string[]> = {};
	for (const row of rows) {
		const entry = rowOf(row);
		if (!entry.ok) return entry;
		const [capability, adapters] = entry.value;
		if (Object.hasOwn(record, capability))
			return err(`${capability}: a capability may appear once`);
		record[capability] = adapters;
	}
	const checked = BindingsSchema.safeParse(record);
	return checked.success
		? ok(checked.data)
		: err(issueText(checked.error, ["bindings"]));
};

// The keys the form no longer has go, with the comments on their lines.
const dropRows = (
	doc: Doc,
	prefix: readonly string[],
	keep: Record<string, readonly string[]>,
) => {
	const map = at(doc, prefix);
	if (!isMap(map)) return;
	for (const item of [...map.items])
		if (!Object.hasOwn(keep, String(item.key)))
			doc.deleteIn([...prefix, String(item.key)]);
};

/**
 * The file's new text with the rows set, or removed when the form has none; refused with the
 * schema's first issue, so nothing invalid is written.
 */
export const bindingsText = (
	text: string | undefined,
	target: Target,
	rows: BindingsDraft,
): Result<string, string> => {
	const doc = parseDocument(text ?? "");
	const [first] = doc.errors;
	if (first) return err(first.message);
	const record = recordOf(rows);
	if (!record.ok) return record;
	const prefix = prefixOf(target);
	const section = sectionOf(doc, prefix, rows.length > 0);
	if (!section.ok) return section;
	dropRows(doc, prefix, record.value);
	for (const [capability, adapters] of Object.entries(record.value))
		doc.setIn([...prefix, capability], [...adapters]);
	dropSection(doc, prefix, rows.length);
	const checked = BindingsSchema.safeParse(valueAt(doc.toJS(), prefix) ?? {});
	return checked.success
		? ok(isEmpty(doc) ? "" : doc.toString())
		: err(issueText(checked.error, prefix));
};
