// An agent's questions before its work (docs/08, step 1; ADR-142), each line with the likely
// answers its agent may offer in square brackets at its end (ADR-148). Pure.

export type Question = {
	readonly text: string;
	readonly options: readonly string[];
};

// A model often numbers or bullets its questions; each shows once, unmarked.
const MARKER = /^(?:\d+[.)]|[-*])\s+/;
const OFFERED = /^(.+?)\s*\[([^[\]]*)\]$/;

const questionOf = (line: string): Question => {
	const m = OFFERED.exec(line);
	const options = (m?.[2] ?? "")
		.split("|")
		.map((o) => o.trim())
		.filter((o) => o !== "");
	return m?.[1] && options.length >= 2
		? { text: m[1], options }
		: { text: line, options: [] };
};

/** The questions of a `task.clarification.requested`; a bracket of fewer than two options stays text. */
export const questionsOf = (text: string): Question[] =>
	text
		.split("\n")
		.map((line) => line.trim().replace(MARKER, ""))
		.filter((line) => line !== "")
		.map(questionOf);

/** The answer with `option` picked for `question`, on a line of its own that replaces an earlier pick. */
export const withPick = (answer: string, question: string, option: string) => {
	const head = `${question} — `;
	const line = `${head}${option}`;
	const lines = answer === "" ? [] : answer.split("\n");
	const at = lines.findIndex((l) => l.startsWith(head));
	return (at < 0 ? [...lines, line] : lines.with(at, line)).join("\n");
};
