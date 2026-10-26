import { z } from "zod";
import type { verifyOf } from "./team-run.js";

// Verify gates of a task (docs/08, Task execution sequence, step 3): machine checks the engine runs
// before the guardrail, and the message that sends a failed one back to the agent. Pure.
// shortcut: a capability gate's `expect` has no meaning yet (ADR-120); upgrade when one is defined.

export type Gate = ReturnType<typeof verifyOf>[number];

/** What verify.completed names a gate by: its command, or its capability id (ADR-120). */
export const gateName = (g: Gate) => ("run" in g ? g.run : g.capability);

/** What a gate command left behind; shell.exec@1 reports exitCode null for a killed process. */
export const ShellRunSchema = z.object({
	exitCode: z.number().nullable(),
	stdout: z.string(),
	stderr: z.string(),
	timedOut: z.boolean(),
});
export type ShellRun = z.infer<typeof ShellRunSchema>;

const stream = (name: string, text: string) =>
	text.trim() === "" ? "" : `${name}:\n${text.trimEnd()}`;

const message = (parts: readonly string[]) =>
	parts.filter((p) => p !== "").join("\n\n");

/** The user message for a gate that failed, or undefined when its command exited with 0. */
export const gateFailure = (
	command: string,
	r: ShellRun,
): string | undefined => {
	if (r.exitCode === 0 && !r.timedOut) return undefined;
	const how = r.timedOut
		? "timed out"
		: r.exitCode === null
			? "was killed"
			: `exited with code ${r.exitCode}`;
	return message([
		`The verify gate \`${command}\` ${how}.`,
		stream("stdout", r.stdout),
		stream("stderr", r.stderr),
		"Fix what it reports, then give your report again.",
	]);
};

/** The user message for a capability gate whose capability answered with an error. */
export const gateError = (capability: string, reason: string) =>
	message([
		`The verify gate \`${capability}\` failed: ${reason}`,
		"Fix what it reports, then give your report again.",
	]);

/** The user message for a gate whose command could not run at all. */
export const gateRefused = (command: string, reason: string) =>
	message([
		`The verify gate \`${command}\` could not run: ${reason}`,
		"Change what stops it, then give your report again.",
	]);
