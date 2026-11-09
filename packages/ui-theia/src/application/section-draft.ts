import {
	err,
	GatewaySettingsSchema,
	ok,
	PolicySchema,
	PrivacyConfigSchema,
	type Result,
	ShellConfigSchema,
} from "@mete/contracts";
import { isMap, parseDocument } from "yaml";
import type { ZodType } from "zod";
import {
	POLICY_RULE_KEYS,
	type PolicyRuleValue,
	readPolicyRule,
} from "./policy-rule-fields.js";
import { setPolicyYamlValue } from "./policy-yaml-values.js";
import { type Doc, isEmpty } from "./yaml-section.js";

// The Settings forms' files (ADR-082): a section edited in place in its YAML file, this folder's
// `.mete/<section>.yaml` or the section key of the global settings.yaml, so other keys and comments
// stay. Only the keys the form changed are set or removed; a key the file does not set stays unset.

/** The sections that have a form. */
export type FormSection = "gateway" | "privacy" | "policy" | "shell";

/** One field of a form: where it lives in the section, and what it holds. */
export type FieldSpec = {
	readonly path: readonly string[];
	readonly kind:
		| {
				readonly type: "choice";
				readonly options: readonly (string | number)[];
		  }
		| { readonly type: "number"; readonly integer?: boolean }
		| { readonly type: "switch" }
		| { readonly type: "text" };
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
	// docs/10, Built-in tools: which shell runs a command on Windows, and where Git Bash is.
	shell: [
		{
			path: ["windows"],
			kind: { type: "choice", options: ["powershell", "git-bash"] },
		},
		{ path: ["gitBashPath"], kind: { type: "text" } },
	],
};

const SCHEMAS: { readonly [S in FormSection]: ZodType } = {
	gateway: GatewaySettingsSchema,
	privacy: PrivacyConfigSchema,
	policy: PolicySchema,
	shell: ShellConfigSchema,
};

/** Where a form saves: this folder's file of the section, or the global settings.yaml. */
export type Target = "workspace" | "global";

/** A field's value, or undefined when the file does not set it. */
export type FieldValue =
	| string
	| number
	| boolean
	| PolicyRuleValue
	| undefined;

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

const pathsOf = (section: FormSection): readonly (readonly string[])[] => [
	...FORM_FIELDS[section].map((field) => field.path),
	...(section === "policy"
		? POLICY_RULE_KEYS.map((key) => key.split("."))
		: []),
];

const readField = (
	section: FormSection,
	path: readonly string[],
	value: unknown,
) => {
	const rule =
		section === "policy" && POLICY_RULE_KEYS.find((key) => key === keyOf(path));
	if (rule) return readPolicyRule(rule, value);
	const parsed = asField(value);
	return parsed === undefined && value !== undefined
		? err(`${keyOf(path)}: expected a scalar setting`)
		: ok(parsed);
};

const fieldsOf = (
	root: unknown,
	section: FormSection,
): Result<Draft, string> => {
	const fields: Record<string, FieldValue> = {};
	for (const path of pathsOf(section)) {
		const result = readField(section, path, valueAt(root, path));
		if (!result.ok) return result;
		fields[keyOf(path)] = result.value;
	}
	return ok(fields);
};

/** The defaults the form shows as placeholders, from the section's schema. */
export const defaultsOf = (section: FormSection): Draft => {
	const result = fieldsOf(SCHEMAS[section].parse({}), section);
	if (!result.ok) throw new Error("Invalid built-in settings fields");
	return result.value;
};

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
	return fieldsOf(root, section);
};

/** Global policy values supply inherited controls, without becoming workspace edits. */
export const inheritedDefaults = (
	text: string | undefined,
	section: FormSection,
): Result<Draft, string> => {
	const doc = parseDocument(text ?? "");
	if (doc.errors[0]) return err(doc.errors[0].message);
	const value = valueAt(doc.toJS(), [section]);
	const fields = fieldsOf(value, section);
	if (!fields.ok) return fields;
	const result = SCHEMAS[section].safeParse(value ?? {});
	return result.success
		? fieldsOf(result.data, section)
		: err(result.error.issues[0]?.message ?? "Invalid inherited settings");
};

/** Whether the text sets any key; a missing, empty or comment-only file sets none. */
export const hasKeys = (text: string | undefined): boolean => {
	const { contents } = parseDocument(text ?? "");
	return isMap(contents) && contents.items.length > 0;
};

// A map a removed key left empty goes with it, so a cleared field leaves no `budget: {}` behind.
const prune = (doc: Doc, at: readonly string[]) => {
	for (let n = at.length - 1; n > 0; n--) {
		const parent = doc.getIn(at.slice(0, n), true);
		if (!isMap(parent) || parent.items.length > 0) return;
		doc.deleteIn(at.slice(0, n));
	}
};

// A key set to its new value, or removed when cleared; deleteIn throws on a missing key.
const setOrClear = (
	doc: Doc,
	at: readonly string[],
	value: FieldValue,
): Result<void, string> => {
	if (value !== undefined) {
		if (typeof value === "object") return setPolicyYamlValue(doc, at, value);
		doc.setIn(at, value);
	} else if (doc.hasIn(at)) {
		doc.deleteIn(at);
		prune(doc, at);
	}
	return ok(undefined);
};

/**
 * The file's new text with the changed fields set, or removed when cleared; refused with the schema's
 * first issue when the section would not validate, so nothing invalid is written.
 */
type SaveInput = {
	readonly text: string | undefined;
	readonly section: FormSection;
	readonly target: Target;
	readonly changes: Draft;
	readonly globalText?: string | undefined;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const mergeMap = (base: unknown, over: unknown): unknown => {
	if (over === undefined) return base;
	if (!isRecord(base) || !isRecord(over)) return over;
	return Object.fromEntries([...Object.entries(base), ...Object.entries(over)]);
};

// These are the only nested maps in the supported settings schemas. Arrays replace whole.
const mergeLayer = (
	base: unknown,
	over: unknown,
	section: FormSection,
): unknown => {
	const merged = mergeMap(base, over);
	if (section !== "policy" || !isRecord(merged)) return merged;
	return Object.fromEntries(
		Object.entries(merged).map(([key, value]) => [
			key,
			["shell", "budget", "overrides"].includes(key)
				? mergeMap(valueAt(base, [key]), valueAt(over, [key]))
				: value,
		]),
	);
};

const validateSaved = (doc: Doc, input: SaveInput): Result<string, string> => {
	const { section, target } = input;
	const prefix = prefixOf(section, target);
	const value = valueAt(doc.toJS(), prefix);
	const fields = fieldsOf(value, section);
	if (!fields.ok) return fields;
	const global = parseDocument(
		target === "workspace" ? (input.globalText ?? "") : "",
	);
	if (global.errors[0]) return err(global.errors[0].message);
	const inherited = valueAt(global.toJS(), [section]);
	const inheritedFields = fieldsOf(inherited, section);
	if (!inheritedFields.ok) return inheritedFields;
	const checked = SCHEMAS[section].safeParse(
		mergeLayer(inherited, value, section) ?? {},
	);
	const issue = checked.success ? undefined : checked.error.issues[0];
	if (issue)
		return err(`${[...prefix, ...issue.path].join(".")}: ${issue.message}`);
	return ok(isEmpty(doc) ? "" : doc.toString());
};

/** Validates the effective merged settings while writing only the selected file's changed keys. */
export const savedLayeredText = (input: SaveInput): Result<string, string> => {
	const { text, section, target, changes } = input;
	const doc = parseDocument(text ?? "");
	const [first] = doc.errors;
	if (first) return err(first.message);
	const prefix = prefixOf(section, target);
	for (const path of pathsOf(section)) {
		if (!Object.hasOwn(changes, keyOf(path))) continue;
		const value = readField(section, path, changes[keyOf(path)]);
		if (!value.ok) return value;
		const written = setOrClear(doc, [...prefix, ...path], value.value);
		if (!written.ok) return written;
	}
	return validateSaved(doc, input);
};

/** Standalone-file validation retained for callers without an inherited settings layer. */
export const savedText = (
	text: string | undefined,
	section: FormSection,
	target: Target,
	changes: Draft,
): Result<string, string> =>
	savedLayeredText({ text, section, target, changes });
