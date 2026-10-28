import { LessonSchema } from "@mete/contracts";
import { jsonOf } from "./guardrail.js";

// The lesson of docs/08, step 8 (ADR-145): what the task's agent is asked once its task is approved,
// and the vault.write@1 input its reply becomes. Pure.

/** The user message after the approved task's conversation. */
export const LESSON_ASK = `Your task is approved. Write the one lesson from this work that would help a later run: what worked or failed, and why.
Reply without calling a tool, with only a JSON object of the lesson@1 shape:
{"title": "...", "lesson": "...", "evidence": "a file, command or error code that shows it", "tags": ["..."]}`;

/** The note a reply asks to write, read as the guardrail reads a report; undefined when it is no lesson@1. */
export const lessonNote = (reply: string) => {
	const json = jsonOf(reply);
	const lesson = json && LessonSchema.safeParse(json.value);
	if (!lesson?.success) return undefined;
	const { title, lesson: text, evidence, tags } = lesson.data;
	return {
		type: "lesson",
		title,
		body: `${text}\n\nEvidence: ${evidence}`,
		tags: [...tags],
	} as const;
};
