import type { Elicit, ElicitRequestFormParams, ElicitResult } from "@mete/mcp";
import { ELICIT_TRIES } from "../defaults.js";
import type { Io } from "./commands.js";

// Elicitation in the terminal (docs/10, MCP client): the server's form, one question per field.
// Everything the server wrote is printed as plain text, so it cannot move the cursor or fake a prompt.

type Field = ElicitRequestFormParams["requestedSchema"]["properties"][string];
type Value = string | number | boolean;
type Answer = { readonly value: Value } | "skip" | "decline" | "cancel";

const BOOLEANS = new Map([
	["y", true],
	["yes", true],
	["true", true],
	["n", false],
	["no", false],
	["false", false],
]);

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is removed
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

const clean = (text: string) => text.replace(CONTROL, " ").trim();

const options = (f: Field): readonly string[] | undefined => {
	if ("enum" in f) return f.enum;
	if ("oneOf" in f) return f.oneOf.map((o) => o.const);
	return undefined;
};

const parseNumber = (type: "number" | "integer", line: string) => {
	const n = Number(line);
	const whole = type === "number" || Number.isInteger(n);
	return Number.isFinite(n) && whole ? n : undefined;
};

const parse = (f: Field, line: string): Value | undefined => {
	const list = options(f);
	if (list) return list.includes(line) ? line : undefined;
	if (f.type === "boolean") return BOOLEANS.get(line.toLowerCase());
	if (f.type === "number" || f.type === "integer")
		return parseNumber(f.type, line);
	return f.type === "string" ? line : undefined;
};

const promptOf = (name: string, f: Field, required: boolean) => {
	const list = options(f);
	const kind = list
		? list.map(clean).join(" / ")
		: f.type === "boolean"
			? "y/n"
			: f.type;
	const about = f.description ? ` - ${clean(f.description)}` : "";
	return `${clean(f.title ?? name)}${about} (${required ? kind : `${kind}, optional`}): `;
};

// shortcut: a field's default is not offered, an empty answer to an optional field leaves it out; upgrade when a server needs it.
const askField = async (
	read: (prompt: string) => Promise<string | undefined>,
	[name, f]: readonly [string, Field],
	required: boolean,
): Promise<Answer> => {
	const prompt = promptOf(name, f, required);
	for (let i = 0; i < ELICIT_TRIES; i++) {
		const line = await read(prompt);
		if (line === undefined) return "cancel";
		const text = line.trim();
		if (!text && !required) return "skip";
		const value = text ? parse(f, text) : undefined;
		if (value !== undefined) return { value };
	}
	return "decline";
};

// Asks every field in order; the first decline or cancel ends the request.
const askAll = async (
	read: (prompt: string) => Promise<string | undefined>,
	fields: readonly (readonly [string, Field])[],
	required: readonly string[],
	signal: AbortSignal,
): Promise<ElicitResult> => {
	const content: Record<string, Value> = {};
	for (const field of fields) {
		if (signal.aborted) return { action: "cancel" };
		const answer = await askField(read, field, required.includes(field[0]));
		if (answer === "decline" || answer === "cancel") return { action: answer };
		if (answer !== "skip") content[field[0]] = answer.value;
	}
	return { action: "accept", content };
};

/**
 * The Elicit of a terminal: it asks nothing and declines when standard input is not a terminal,
 * which also keeps `mete mcp` quiet, since its standard output is the protocol.
 */
export const terminalElicit =
	(io: Io): Elicit =>
	async (server, params, signal) => {
		const read = io.readLine;
		if (!read) return { action: "decline" };
		const { properties, required = [] } = params.requestedSchema;
		const fields = Object.entries(properties);
		// shortcut: a multiple-choice field is not asked, the whole request is declined; upgrade with a list prompt.
		if (fields.some(([, f]) => f.type === "array"))
			return { action: "decline" };
		io.out(`MCP server ${clean(server)} asks:`);
		io.out(`  ${clean(params.message)}`);
		return askAll(read, fields, required, signal);
	};
