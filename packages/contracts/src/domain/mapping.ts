import { z } from "zod";
import {
	type CapabilityRef,
	CapabilityRefSchema,
	SemverSchema,
} from "./ids.js";
import { PolicyActionSchema } from "./policy.js";
import { err, ok, type Result } from "./result.js";
import { WebSearchOutputSchema } from "./web.js";

// Level 2 mapping files from docs/10 (Integration levels): `adapters/<id>.yaml`. Expressions are
// `{{path}}` with the filters join and json only [D]; `each` maps a list item by item [D].

/** One filter of an expression. */
export type Filter =
	| { readonly name: "json" }
	| { readonly name: "join"; readonly separator: string };

/** A piece of a template string: literal text or an expression over a dotted path. */
export type TemplatePart =
	| { readonly text: string }
	| { readonly path: readonly string[]; readonly filters: readonly Filter[] };

/** The names an expression may start from; `item` only inside `each`. */
export const EXPRESSION_ROOTS = ["input", "result", "workspace", "item"];

const EXPR = /\{\{(.*?)\}\}/g;
const PATH = /^[A-Za-z_]\w*(\.\w+)*$/;
const JOIN = /^join\((?:'([^']*)'|"([^"]*)")\)$/;

const filterOf = (f: string): Filter | undefined => {
	if (f === "json") return { name: "json" };
	const m = JOIN.exec(f);
	return m ? { name: "join", separator: m[1] ?? m[2] ?? "" } : undefined;
};

const expressionOf = (body: string): Result<TemplatePart, string> => {
	const [head = "", ...rest] = body.split("|").map((s) => s.trim());
	if (!PATH.test(head)) return err(`"${head}" is not a dotted path`);
	const path = head.split(".");
	if (!EXPRESSION_ROOTS.includes(path[0] ?? ""))
		return err(`"${head}" must start with ${EXPRESSION_ROOTS.join(", ")}`);
	const filters: Filter[] = [];
	for (const f of rest) {
		const filter = filterOf(f);
		if (!filter) return err(`unknown filter "${f}"; only join and json`);
		filters.push(filter);
	}
	return ok({ path, filters });
};

/** Splits a template string into text and expressions, or names the first bad expression. */
export const templateParts = (s: string): Result<TemplatePart[], string> => {
	const parts: TemplatePart[] = [];
	let at = 0;
	for (const m of s.matchAll(EXPR)) {
		if (m.index > at) parts.push({ text: s.slice(at, m.index) });
		const e = expressionOf(m[1] ?? "");
		if (!e.ok) return e;
		parts.push(e.value);
		at = m.index + m[0].length;
	}
	if (at < s.length) parts.push({ text: s.slice(at) });
	return ok(parts);
};

const TemplateStringSchema = z.string().check((ctx) => {
	const r = templateParts(ctx.value);
	if (!r.ok)
		ctx.issues.push({ code: "custom", message: r.error, input: ctx.value });
});

/** `{ each: "{{a list}}", as: <value per item> }`: the list mapped item by item. */
export type EachValue = { readonly each: string; readonly as: TemplateValue };

/** A mapped value: strings hold expressions; a string that is one expression keeps its type. */
export type TemplateValue =
	| string
	| number
	| boolean
	| null
	| EachValue
	| readonly TemplateValue[]
	| { readonly [key: string]: TemplateValue };

const single = (s: string) => {
	const r = templateParts(s);
	return r.ok && r.value.length === 1 && "path" in (r.value[0] ?? {});
};

const EachSchema = z.strictObject({
	each: TemplateStringSchema.refine(
		single,
		"each takes exactly one expression",
	),
	get as(): z.ZodType<TemplateValue> {
		return TemplateValueSchema;
	},
});

// An object with an `each` key must be a valid each, so a broken one is refused, not copied.
export const TemplateValueSchema: z.ZodType<TemplateValue> = z.lazy(() =>
	z.union([
		TemplateStringSchema,
		z.number(),
		z.boolean(),
		z.null(),
		z.array(TemplateValueSchema).readonly(),
		z.record(z.string(), TemplateValueSchema).refine((o) => !("each" in o)),
		EachSchema,
	]),
);

const kebab = z
	.string()
	.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "expected a kebab-case id");

const McpEntrySchema = z.strictObject({
	tool: z.string().min(1),
	args: z.record(z.string(), TemplateValueSchema).default(() => ({})),
	output: TemplateValueSchema,
	action: PolicyActionSchema.default("mcp.call"),
	features: z
		.array(z.string().min(1))
		.readonly()
		.default(() => []),
});

const capabilityKeys = (o: Record<string, unknown>) =>
	Object.keys(o).every((k) => CapabilityRefSchema.safeParse(k).success);

const header = {
	apiVersion: z.literal("mete/v1"),
	kind: z.literal("AdapterMapping"),
	metadata: z.strictObject({ id: kebab, version: SemverSchema }),
};

const McpMappingSchema = z.strictObject({
	...header,
	type: z.literal("mcp"),
	server: kebab,
	implements: z
		.record(z.string(), McpEntrySchema)
		.refine(capabilityKeys, "implements keys are capability ids"),
});

// shortcut: cli and http entries are not checked yet, mcp-client refuses them; upgrade when a slice runs them.
const OtherMappingSchema = z.looseObject({
	...header,
	type: z.enum(["cli", "http"]),
	implements: z.record(z.string(), z.unknown()),
});

/** A level 2 mapping file (docs/10). */
export const AdapterMappingSchema = z.discriminatedUnion("type", [
	McpMappingSchema,
	OtherMappingSchema,
]);
export type AdapterMapping = z.output<typeof AdapterMappingSchema>;
export type McpMapping = z.output<typeof McpMappingSchema>;
export type McpMappingEntry = z.output<typeof McpEntrySchema>;

/** The output schemas a mapped answer is checked against; a capability missing here cannot be mapped. */
export const MAPPABLE_OUTPUTS: Readonly<
	Partial<Record<CapabilityRef, z.ZodType>>
> = {
	"web.search@1": WebSearchOutputSchema,
};
