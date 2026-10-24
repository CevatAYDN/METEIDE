import {
	err,
	GatewaySettingsSchema,
	ok,
	PolicySchema,
	PrivacyConfigSchema,
	type Result,
} from "@mete/contracts";
import { isMap, parseDocument } from "yaml";
import type { ZodType } from "zod";

// The Settings forms' files (ADR-082): a section edited in place in its YAML file, this folder's
// `.mete/<section>.yaml` or the section key of the global settings.yaml, so other keys and comments
// stay. Only the keys the form changed are set or removed; a key the file does not set stays unset.

/** The sections that have a form. */
export type FormSection = "gateway" | "privacy" | "policy";

/** One field of a form: where it lives in the section, and what it holds. */
export type FieldSpec = {
	readonly path: readonly string[];
	readonly kind:
		| {
				readonly type: "choice";
				readonly options: readonly (string | number)[];
		  }
		| { readonly type: "number"; readonly integer?: boolean }
		| { readonly type: "switch" };
};

/** The fields of each form, in the order the form shows them. */
export const FORM_FIELDS: {
	readonly [S in FormSection]: readonly FieldSpec[];
} = {
	gateway: [
		{
			path: ["models"],
			kind: { type: "choice", options: ["free", "paid", "both"] },
		},
		{ path: ["dailySpendUsd"], kind: { type: "number" } },
	],
	privacy: [{ path: ["allowTraining"], kind: { type: "switch" } }],
	policy: [
		{ path: ["autonomy"], kind: { type: "choice", options: [0, 1, 2, 3] } },
		{
			path: ["budget", "cloud_requests_per_run"],
			kind: { type: "number", integer: true },
		},
		{ path: ["budget", "max_hours"], kind: { type: "number" } },
	],
};

const SCHEMAS: { readonly [S in FormSection]: ZodType } = {
	gateway: GatewaySettingsSchema,
	privacy: PrivacyConfigSchema,
	policy: PolicySchema,
};

/** Where a form saves: this folder's file of the section, or the global settings.yaml. */
export type Target = "workspace" | "global";

/** A field's value, or undefined when the file does not set it. */
export type FieldValue = string | number | boolean | undefined;

/** The values the form edits, keyed by the field's path joined with dots. */
export type Draft = Readonly<Record<string, FieldValue>>;

const keyOf = (path: readonly string[]) => path.join(".");
const prefixOf = (section: FormSection, target: Target) =>
	target === "global" ? [section] : [];

/** The value at a path of keys, or undefined where one is missing. */
export const valueAt = (root: unknown, path: readonly string[]): unknown =>
	path.reduce<unknown>(
		(at, k) =>
			typeof at === "object" && at !== null
				? (at as Record<string, unknown>)[k]
				: undefined,
		root,
	);

const asField = (v: unknown): FieldValue =>
	typeof v === "string" || typeof v === "number" || typeof v === "boolean"
		? v
		: undefined;

/** The defaults the form shows as placeholders, from the section's schema. */
export const defaultsOf = (section: FormSection): Draft =>
	Object.fromEntries(
		FORM_FIELDS[section].map((f) => [
			keyOf(f.path),
			asField(valueAt(SCHEMAS[section].parse({}), f.path)),
		]),
	);

/** A configuration layer as `mete/settings` returns it: the section's value in one file. */
export type Layers = {
	readonly workspace?: { readonly value: unknown } | undefined;
	readonly global?: { readonly value: unknown } | undefined;
};

/**
 * Which file METE loaded a field of the form from: this folder's when it sets one, else the global
 * one, else none. Only the form's own fields count, since the file may hold keys it has no field for.
 */
export const layerOf = (
	section: FormSection,
	layers: Layers,
): Target | undefined => {
	const sets = (layer: Layers["global"]) =>
		FORM_FIELDS[section].some(
			(f) => valueAt(layer?.value, f.path) !== undefined,
		);
	if (sets(layers.workspace)) return "workspace";
	return sets(layers.global) ? "global" : undefined;
};

/** What the file sets of the form's fields; a missing file sets nothing. */
export const draftOf = (
	text: string | undefined,
	section: FormSection,
	target: Target,
): Result<Draft, string> => {
	const doc = parseDocument(text ?? "");
	const [first] = doc.errors;
	if (first) return err(first.message);
	const root = valueAt(doc.toJS(), prefixOf(section, target));
	return ok(
		Object.fromEntries(
			FORM_FIELDS[section].map((f) => [
				keyOf(f.path),
				asField(valueAt(root, f.path)),
			]),
		),
	);
};

type Doc = ReturnType<typeof parseDocument>;

// A map a removed key left empty goes with it, so a cleared field leaves no `budget: {}` behind.
const prune = (doc: Doc, at: readonly string[]) => {
	for (let n = at.length - 1; n > 0; n--) {
		const parent = doc.getIn(at.slice(0, n), true);
		if (!isMap(parent) || parent.items.length > 0) return;
		doc.deleteIn(at.slice(0, n));
	}
};

// A key set to its new value, or removed when cleared; deleteIn throws on a missing key.
const setOrClear = (doc: Doc, at: readonly string[], value: FieldValue) => {
	if (value !== undefined) return doc.setIn(at, value);
	if (!doc.hasIn(at)) return;
	doc.deleteIn(at);
	prune(doc, at);
};

// An empty document prints as `null` and an empty map as `{}`: write nothing, as for a file not set.
const isEmpty = (doc: Doc) =>
	doc.contents === null ||
	(isMap(doc.contents) && doc.contents.items.length === 0);

/**
 * The file's new text with the changed fields set, or removed when cleared; refused with the schema's
 * first issue when the section would not validate, so nothing invalid is written.
 */
export const savedText = (
	text: string | undefined,
	section: FormSection,
	target: Target,
	changes: Draft,
): Result<string, string> => {
	const doc = parseDocument(text ?? "");
	const [first] = doc.errors;
	if (first) return err(first.message);
	const prefix = prefixOf(section, target);
	for (const f of FORM_FIELDS[section])
		if (keyOf(f.path) in changes)
			setOrClear(doc, [...prefix, ...f.path], changes[keyOf(f.path)]);
	const checked = SCHEMAS[section].safeParse(valueAt(doc.toJS(), prefix) ?? {});
	const [issue] = checked.success ? [] : checked.error.issues;
	if (issue)
		return err(`${[...prefix, ...issue.path].join(".")}: ${issue.message}`);
	return ok(isEmpty(doc) ? "" : doc.toString());
};
