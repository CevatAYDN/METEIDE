import { err, ok, ProvidersConfigSchema, type Result } from "@mete/contracts";
import { parseDocument } from "yaml";
import { type Target, valueAt } from "./section-draft.js";

// The custom endpoints card's file (ADR-087): `providers.custom` in the global settings.yaml or this
// folder's `.mete/providers.yaml`, edited in place as ADR-082's forms edit theirs, so other keys and
// comments stay. The list is written whole, so a comment inside an endpoint does not survive a Save.

/** One endpoint as the card edits it; its headers as `Name: value` lines. */
export type EndpointDraft = {
	readonly slug: string;
	readonly name: string;
	readonly baseUrl: string;
	readonly format: string;
	readonly headers: string;
};

const prefixOf = (target: Target) => (target === "global" ? ["providers"] : []);

const text = (v: unknown) => (typeof v === "string" ? v : "");

const linesOf = (headers: unknown) =>
	typeof headers === "object" && headers !== null
		? Object.entries(headers)
				.map(([k, v]) => `${k}: ${text(v)}`)
				.join("\n")
		: "";

const draftOf = (entry: unknown): EndpointDraft => ({
	slug: text(valueAt(entry, ["slug"])),
	name: text(valueAt(entry, ["name"])),
	baseUrl: text(valueAt(entry, ["baseUrl"])),
	format: text(valueAt(entry, ["format"])),
	headers: linesOf(valueAt(entry, ["headers"])),
});

/** The endpoints the file lists; a missing file lists none. */
export const endpointsOf = (
	file: string | undefined,
	target: Target,
): Result<EndpointDraft[], string> => {
	const doc = parseDocument(file ?? "");
	const [first] = doc.errors;
	if (first) return err(first.message);
	const list = valueAt(doc.toJS(), [...prefixOf(target), "custom"]);
	return ok(Array.isArray(list) ? list.map(draftOf) : []);
};

const headersOf = (
	d: EndpointDraft,
): Result<Record<string, string>, string> => {
	const headers: Record<string, string> = {};
	for (const line of d.headers.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const at = line.indexOf(":");
		if (at <= 0)
			return err(`${d.slug}: a header line needs "Name: value": ${line}`);
		headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
	}
	return ok(headers);
};

// What the file holds for one endpoint; no headers key when it has none, as the schema defaults it.
const entryOf = (d: EndpointDraft): Result<object, string> => {
	const headers = headersOf(d);
	if (!headers.ok) return headers;
	const { slug, name, baseUrl, format } = d;
	return ok({
		slug,
		name,
		baseUrl,
		format,
		...(Object.keys(headers.value).length > 0
			? { headers: headers.value }
			: {}),
	});
};

const entriesOf = (
	list: readonly EndpointDraft[],
): Result<object[], string> => {
	const entries: object[] = [];
	for (const d of list) {
		const entry = entryOf(d);
		if (!entry.ok) return entry;
		entries.push(entry.value);
	}
	return ok(entries);
};

/**
 * The file's new text with the list in place, or without `custom` when the list is empty; refused
 * with the schema's first issue, so nothing invalid is written.
 */
export const savedEndpointsText = (
	file: string | undefined,
	target: Target,
	list: readonly EndpointDraft[],
): Result<string, string> => {
	const doc = parseDocument(file ?? "");
	const [first] = doc.errors;
	if (first) return err(first.message);
	const listed = entriesOf(list);
	if (!listed.ok) return listed;
	const entries = listed.value;
	const prefix = prefixOf(target);
	const at = [...prefix, "custom"];
	if (entries.length > 0) doc.setIn(at, entries);
	else if (doc.hasIn(at)) doc.deleteIn(at);
	const checked = ProvidersConfigSchema.safeParse(
		valueAt(doc.toJS(), prefix) ?? {},
	);
	const [issue] = checked.success ? [] : checked.error.issues;
	if (issue)
		return err(`${[...prefix, ...issue.path].join(".")}: ${issue.message}`);
	// An empty document prints as `null`, which the loader would read as the section: write nothing.
	return ok(doc.contents === null ? "" : doc.toString());
};
