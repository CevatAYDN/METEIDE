import { z } from "zod";
import type { verifyOf } from "./team-run.js";

// Verify gates of a task (docs/08, Task execution sequence, step 3): machine checks the engine runs
// before the guardrail, and the message that sends a failed one back to the agent. Pure.
// shortcut: only the `run` form is run; the capability form has no defined `expect` or failure yet.

type Gate = ReturnType<typeof verifyOf>[number];

/** The shell commands of a task's gates, in template order. */
export const commandsOf = (gates: readonly Gate[]) =>
	gates.flatMap((g) => ("run" in g ? [g.run] : []));

/** True when a gate names a capability instead of a command; those are not run yet. */
export const hasCapabilityGate = (gates: readonly Gate[]) =>
	gates.some((g) => "capability" in g);

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

/** The user message for a gate whose command could not run at all. */
export const gateRefused = (command: string, reason: string) =>
	message([
		`The verify gate \`${command}\` could not run: ${reason}`,
		"Change what stops it, then give your report again.",
	]);
