import { err, ok, type Result, type SkillError } from "@mete/contracts";
import { isAlias, isScalar, type Node, parseDocument, visit } from "yaml";

type Replacement = { start: number; end: number; text: string };
const unavailable = () => err<SkillError>({ code: "unavailable" });

const scalarReplacement = (raw: string, masked: string) => {
	// Block headers include comments; keep them and the terminating source newline.
	const header = /^[|>][1-9+-]*([^\r\n]*)/u.exec(raw)?.[1] ?? "";
	const newline = /\r?\n$/u.exec(raw)?.[0] ?? "";
	return JSON.stringify(masked) + header + newline;
};

const replacementFor = (
	node: Node,
	frontmatter: string,
	values: ReadonlyMap<string, string>,
): Result<Replacement | undefined, SkillError> => {
	if (!isScalar(node) || typeof node.value !== "string") return ok(undefined);
	const masked = values.get(node.value);
	if (masked === undefined || masked === node.value) return ok(undefined);
	const range = node.range;
	if (!range || range[0] < 0 || range[1] > frontmatter.length)
		return unavailable();
	const [start, end] = range;
	return ok({
		start,
		end,
		text: scalarReplacement(frontmatter.slice(start, end), masked),
	});
};

const replacementsFor = (
	frontmatter: string,
	values: ReadonlyMap<string, string>,
): Result<Replacement[], SkillError> => {
	const doc = parseDocument(frontmatter, {
		uniqueKeys: true,
		strict: true,
		logLevel: "silent",
	});
	if (doc.errors.length || doc.warnings.length) return unavailable();
	const replacements: Replacement[] = [];
	let invalid = false;
	visit(doc, {
		Node: (_key, node) => {
			if (isAlias(node) || node.anchor !== undefined) invalid = true;
			const replacement = replacementFor(node, frontmatter, values);
			if (!replacement.ok) {
				invalid = true;
				return;
			}
			if (replacement.value) replacements.push(replacement.value);
		},
	});
	return invalid ? unavailable() : ok(replacements);
};

/** Private display-only scalar edits; never serialize the document or change byte identity. */
export const maskSkillFrontmatter = (
	text: string,
	values: ReadonlyMap<string, string>,
): Result<string, SkillError> => {
	const parts = /^(\uFEFF?---\r?\n)([\s\S]*?)^---(?:\r?\n|$)([\s\S]*)$/mu.exec(
		text,
	);
	if (
		parts?.index !== 0 ||
		parts[1] === undefined ||
		parts[2] === undefined ||
		!parts[3]?.trim()
	)
		return unavailable();
	const replacements = replacementsFor(parts[2], values);
	if (!replacements.ok) return replacements;
	const offset = parts[1].length;
	let masked = text;
	for (const { start, end, text: replacement } of replacements.value.sort(
		(a, b) => b.start - a.start,
	)) {
		masked =
			masked.slice(0, offset + start) +
			replacement +
			masked.slice(offset + end);
	}
	return ok(masked);
};
