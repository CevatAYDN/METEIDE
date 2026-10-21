import { CapabilityRefSchema, err, ok } from "@mete/contracts";
import { z } from "zod";
import type { ConfigReader } from "./module.js";

// Configuration layers from ARCHITECTURE.md (Configuration).

/** Parsed YAML before any module schema: global sections and workspace files by name. */
export type ConfigLayers = {
	readonly global: {
		readonly file: string;
		readonly sections: Readonly<Record<string, unknown>>;
	};
	readonly workspace: Readonly<
		Record<string, { readonly file: string; readonly value: unknown }>
	>;
};

/** `.mete/bindings.yaml`: adapter ids per capability, in fallback order (docs/10). */
export const BindingsSchema = z.record(
	z.string().pipe(CapabilityRefSchema),
	z.array(z.string().min(1)).readonly(),
);

const isObject = (v: unknown): v is Readonly<Record<string, unknown>> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const own = (v: Readonly<Record<string, unknown>>, k: string) =>
	Object.hasOwn(v, k) ? v[k] : undefined;

// Objects merge key by key; arrays and scalars replace. fromEntries defines own
// properties, so a "__proto__" key from YAML cannot reach the prototype.
const deepMerge = (base: unknown, over: unknown): unknown => {
	if (over === undefined) return base;
	if (!isObject(base) || !isObject(over)) return over;
	const keys = new Set([...Object.keys(base), ...Object.keys(over)]);
	return Object.fromEntries(
		[...keys].map((k) => [k, deepMerge(own(base, k), own(over, k))]),
	);
};

// How much of the path a file's value sets. Arrays replace whole on merge, so a path
// through an array counts in full: everything inside one came from that file.
const depthOf = (value: unknown, path: ReadonlyArray<string>): number => {
	let at = value;
	for (const [i, k] of path.entries()) {
		if (Array.isArray(at)) return path.length;
		if (!isObject(at) || !Object.hasOwn(at, k)) return i;
		at = at[k];
	}
	return path.length;
};

/** Reads merged sections; each call validates against the caller's schema. */
export const createConfigReader = (layers: ConfigLayers): ConfigReader => ({
	get(key, schema) {
		const ws = layers.workspace[key];
		const merged = deepMerge(own(layers.global.sections, key), ws?.value);
		const r = schema.safeParse(merged);
		if (r.success) return ok(r.data);
		const [issue] = r.error.issues;
		const path = (issue?.path ?? []).map(String);
		// The bad or missing value belongs to the file that sets the most of its path;
		// the workspace wins a tie, as it does on merge.
		const wsDepth = ws === undefined ? -1 : depthOf(ws.value, path);
		const globalDepth = depthOf(own(layers.global.sections, key), path);
		const fromWorkspace =
			ws !== undefined &&
			(path.length === 0 || (wsDepth > 0 && wsDepth >= globalDepth));
		return err({
			code: "config_invalid",
			file: fromWorkspace ? ws.file : layers.global.file,
			path: (fromWorkspace ? path : [key, ...path]).join("."),
			reason: issue?.message ?? "invalid value",
		});
	},
});
