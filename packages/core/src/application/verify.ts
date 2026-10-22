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

// One gate; undefined when it passed.
const one = async (
	deps: StepDeps,
	command: string,
	run: Run,
): Promise<Gated | undefined> => {
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
		const content = gateRefused(command, out.error.message);
		return { kind: "failed", content: await masked(deps, content) };
	}
	const shell = ShellRunSchema.safeParse(out.value);
	const text = shell.success
		? gateFailure(command, shell.data)
		: gateRefused(command, "shell.exec@1 returned an unexpected result");
	if (text === undefined) return undefined;
	return { kind: "failed", content: await masked(deps, text) };
};

/** Runs the gates in order and stops at the first that does not pass. */
export const verifyGates = async (deps: StepDeps, run: Run): Promise<Gated> => {
	for (const command of run.commands) {
		const gated = await one(deps, command, run);
		if (gated) return gated;
	}
	return { kind: "passed" };
};
