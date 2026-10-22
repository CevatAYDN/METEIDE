import {
	err,
	type Filter,
	ok,
	type Result,
	type TemplatePart,
	type TemplateValue,
	templateParts,
} from "@mete/contracts";

// Renders a mapping value (docs/10, Integration levels): a string that is one expression keeps
// its value's type, text with expressions becomes text, and `each` maps a list item by item.
// A missing path is undefined (empty in text); the capability's output schema then decides.

/** The names expressions read: input, result, workspace and, inside each, item. */
export type Scope = Readonly<Record<string, unknown>>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const at = (scope: Scope, path: readonly string[]) =>
	path.reduce<unknown>(
		(v, key) =>
			isRecord(v) || Array.isArray(v)
				? (v as Record<string, unknown>)[key]
				: undefined,
		scope,
	);

const asText = (v: unknown) =>
	v === undefined || v === null
		? ""
		: typeof v === "string"
			? v
			: JSON.stringify(v);

const apply = (v: unknown, f: Filter) =>
	f.name === "json"
		? JSON.stringify(v ?? null)
		: Array.isArray(v)
			? v.map(asText).join(f.separator)
			: asText(v);

const partValue = (scope: Scope, part: TemplatePart) =>
	"text" in part ? part.text : part.filters.reduce(apply, at(scope, part.path));

const renderString = (s: string, scope: Scope): Result<unknown, string> => {
	const parts = templateParts(s);
	if (!parts.ok) return parts;
	const [only, ...rest] = parts.value;
	if (only && rest.length === 0) return ok(partValue(scope, only));
	return ok(parts.value.map((p) => asText(partValue(scope, p))).join(""));
};

const renderEach = (
	v: { each: string; as: TemplateValue },
	scope: Scope,
): Result<unknown, string> => {
	const list = renderString(v.each, scope);
	if (!list.ok) return list;
	if (!Array.isArray(list.value)) return err(`${v.each} is not a list`);
	return renderList(
		list.value.map(() => v.as),
		(i) => ({ ...scope, item: (list.value as unknown[])[i] }),
	);
};

// Renders each element with its own scope; an error names the element's index.
const renderList = (
	list: readonly TemplateValue[],
	scopeAt: (i: number) => Scope,
): Result<unknown, string> => {
	const out: unknown[] = [];
	for (const [i, x] of list.entries()) {
		const r = render(x, scopeAt(i));
		if (!r.ok) return err(`${i}: ${r.error}`);
		out.push(r.value);
	}
	return ok(out);
};

const renderObject = (
	o: Readonly<Record<string, TemplateValue>>,
	scope: Scope,
): Result<unknown, string> => {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(o)) {
		const r = render(value, scope);
		if (!r.ok) return err(`${key}: ${r.error}`);
		out[key] = r.value;
	}
	return ok(out);
};

/** The value with every expression replaced from the scope. */
export const render = (
	v: TemplateValue,
	scope: Scope,
): Result<unknown, string> => {
	if (typeof v === "string") return renderString(v, scope);
	if (Array.isArray(v)) return renderList(v, () => scope);
	if (isRecord(v) && "each" in v && "as" in v)
		return renderEach(v as { each: string; as: TemplateValue }, scope);
	if (isRecord(v))
		return renderObject(v as Record<string, TemplateValue>, scope);
	return ok(v);
};

/**
 * What `result` is for an MCP tool: its structured content, else its text parsed as JSON when
 * that is an object, else nothing more; `text` always holds the joined text blocks.
 */
export const resultScope = (
	structured: unknown,
	texts: readonly string[],
): Record<string, unknown> => {
	const text = texts.join("\n");
	if (isRecord(structured)) return { ...structured, text };
	try {
		const parsed: unknown = JSON.parse(text);
		return isRecord(parsed) ? { ...parsed, text } : { text };
	} catch {
		return { text };
	}
};
