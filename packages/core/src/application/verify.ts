import type { ToolContext } from "@mete/contracts";
import { gateFailure, gateRefused, ShellRunSchema } from "../domain/verify.js";
import { type Emit, masked, runCapability, type StepDeps } from "./steps.js";

// The verify gates of a task (docs/08, step 3): each `run` command goes through shell.exec@1 with
// the task's ToolContext, so the policy decides whether it runs, asks or is refused.

/** How the gates ended: all passed, one sent the task back, the policy asked, or no shell is active. */
export type Gated =
	| { readonly kind: "passed" }
	| { readonly kind: "failed"; readonly content: string }
	| { readonly kind: "approval" }
	| { readonly kind: "missing" };

type Run = { commands: readonly string[]; ctx: ToolContext; emit: Emit };

// What went wrong, or undefined when the gate passed; a gate that did not run yet is a Gated.
const outcome = async (
	deps: StepDeps,
	command: string,
	run: Run,
): Promise<Gated | string | undefined> => {
	const input = { command };
	const out = await runCapability(
		deps,
		{ ref: "shell.exec@1", input },
		run.ctx,
		run.emit,
	);
	if (!out.ok) {
		if (out.error.code === "capability_missing") return { kind: "missing" };
		if (out.error.code === "approval_required") return { kind: "approval" };
		return gateRefused(command, out.error.message);
	}
	const shell = ShellRunSchema.safeParse(out.value);
	return shell.success
		? gateFailure(command, shell.data)
		: gateRefused(command, "shell.exec@1 returned an unexpected result");
};

// One gate; undefined when it passed. A gate that ran publishes verify.completed (docs/07).
const one = async (
	deps: StepDeps,
	command: string,
	run: Run,
): Promise<Gated | undefined> => {
	const out = await outcome(deps, command, run);
	if (typeof out === "object") return out;
	const content = out === undefined ? "" : await masked(deps, out);
	run.emit({
		type: "verify.completed",
		payload: { gate: command, ok: out === undefined, details: content },
	});
	return out === undefined ? undefined : { kind: "failed", content };
};

/** Runs the gates in order and stops at the first that does not pass. */
export const verifyGates = async (deps: StepDeps, run: Run): Promise<Gated> => {
	for (const command of run.commands) {
		const gated = await one(deps, command, run);
		if (gated) return gated;
	}
	return { kind: "passed" };
};
