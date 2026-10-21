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

const hasPath = (value: unknown, path: ReadonlyArray<string>): boolean => {
	let at = value;
	for (const k of path) {
		if (!isObject(at) || !Object.hasOwn(at, k)) return false;
		at = at[k];
	}
	return true;
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
		// The workspace wins on overlap, so a path it sets is where the bad value came from.
		const fromWorkspace = ws !== undefined && hasPath(ws.value, path);
		return err({
			code: "config_invalid",
			file: fromWorkspace ? ws.file : layers.global.file,
			path: (fromWorkspace ? path : [key, ...path]).join("."),
			reason: issue?.message ?? "invalid value",
		});
	},
});
