import { z } from "zod";

// Tool calls a model wrote into its reply's text instead of the tool-call field (docs/08, Single
// agent; ADR-126). shortcut: two shapes only, Hermes/Qwen `<tool_call>` blocks and a reply that is one
// JSON object (Llama); add `<function=…>` or `[TOOL_CALLS]` once a run shows them. Pure.

/** A call read from the text, without an id yet. */
export type TextCall = { readonly name: string; readonly args: unknown };

const parseJson = (text: string): unknown => {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
};

const Args = z.record(z.string(), z.unknown());
// A model may send the arguments as an object or as that object's JSON text.
const ArgsOrText = z.union([
	Args,
	z.string().transform((s, ctx) => {
		const parsed = Args.safeParse(parseJson(s));
		if (parsed.success) return parsed.data;
		ctx.addIssue({ code: "custom", message: "arguments are no object" });
		return z.NEVER;
	}),
]);
const Call = z.union([
	z.strictObject({ name: z.string(), arguments: ArgsOrText }),
	z.strictObject({ name: z.string(), parameters: ArgsOrText }),
]);

const BLOCK = /<tool_call>([\s\S]*?)<\/tool_call>/g;
// The whole reply as one object, maybe after Llama's python tag or inside one code fence.
const WHOLE =
	/^(?:<\|python_tag\|>)?\s*(?:```(?:json)?\s*([\s\S]*?)\s*```|([\s\S]*))$/;

const callOf = (json: string, offered: ReadonlySet<string>) => {
	const c = Call.safeParse(parseJson(json.trim()));
	if (!c.success || !offered.has(c.data.name)) return undefined;
	const args = "arguments" in c.data ? c.data.arguments : c.data.parameters;
	return { name: c.data.name, args };
};

const blocks = (content: string, offered: ReadonlySet<string>) => {
	const found = [...content.matchAll(BLOCK)].map((m) =>
		callOf(m[1] ?? "", offered),
	);
	if (found.length === 0 || found.some((c) => c === undefined))
		return undefined;
	return {
		content: content.replace(BLOCK, "").trim(),
		calls: found.filter((c) => c !== undefined),
	};
};

/**
 * The calls in a reply's text when every one parses and names an offered tool, with the text that
 * is left; undefined when the reply holds none, or one that does not qualify, so it stays text.
 */
export const textCalls = (
	content: string,
	offered: ReadonlySet<string>,
): { content: string; calls: TextCall[] } | undefined => {
	const inBlocks = blocks(content, offered);
	if (inBlocks) return inBlocks;
	const whole = WHOLE.exec(content.trim());
	const call = callOf(whole?.[1] ?? whole?.[2] ?? "", offered);
	return call ? { content: "", calls: [call] } : undefined;
};
