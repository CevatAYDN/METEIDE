import type { CapabilityRef, ToolContext } from "@mete/contracts";
import {
	type Gate,
	gateError,
	gateFailure,
	gateName,
	gateRefused,
	ShellRunSchema,
} from "../domain/verify.js";
import { type Emit, masked, runCapability, type StepDeps } from "./steps.js";

// The verify gates of a task (docs/08, step 3): each `run` command goes through shell.exec@1 with
// the task's ToolContext, so the policy decides whether it runs, asks or is refused; a gate that
// names a capability calls it the same way (ADR-120).

/** How the gates ended: all passed, one sent the task back, the policy asked, or no shell is active. */
export type Gated =
	| { readonly kind: "passed" }
	| { readonly kind: "failed"; readonly content: string }
	| { readonly kind: "approval" }
	| { readonly kind: "missing" };

type Run = {
	gates: readonly Gate[];
	ctx: ToolContext;
	emit: Emit;
	/** Told of a capability gate that no adapter provides, which is skipped. */
	skipped: (capability: CapabilityRef) => void;
};

// What went wrong, or undefined when the gate passed; a gate that did not run is an object.
type Outcome = Gated | { readonly kind: "skipped" } | string | undefined;

const command = async (
	deps: StepDeps,
	run: Run,
	cmd: string,
): Promise<Outcome> => {
	const out = await runCapability(
		deps,
		{ ref: "shell.exec@1", input: { command: cmd } },
		run.ctx,
		run.emit,
	);
	if (!out.ok) {
		if (out.error.code === "capability_missing") return { kind: "missing" };
		if (out.error.code === "approval_required") return { kind: "approval" };
		return gateRefused(cmd, out.error.message);
	}
	const shell = ShellRunSchema.safeParse(out.value);
	return shell.success
		? gateFailure(cmd, shell.data)
		: gateRefused(cmd, "shell.exec@1 returned an unexpected result");
};

// The capability is called with `args`, `{}` when absent; an ok answer passes.
const capability = async (
	deps: StepDeps,
	run: Run,
	gate: Extract<Gate, { capability: CapabilityRef }>,
): Promise<Outcome> => {
	const input = gate.args ?? {};
	const ref = gate.capability;
	const out = await runCapability(deps, { ref, input }, run.ctx, run.emit);
	if (out.ok) return undefined;
	if (out.error.code === "capability_missing") return { kind: "skipped" };
	if (out.error.code === "approval_required") return { kind: "approval" };
	return gateError(ref, out.error.message);
};

// One gate; undefined when it passed or was skipped. A gate that ran publishes verify.completed (docs/07).
const one = async (
	deps: StepDeps,
	gate: Gate,
	run: Run,
): Promise<Gated | undefined> => {
	const out: Outcome =
		"run" in gate
			? await command(deps, run, gate.run)
			: await capability(deps, run, gate);
	if (typeof out === "object") {
		if (out.kind !== "skipped") return out;
		if ("capability" in gate) run.skipped(gate.capability);
		return undefined;
	}
	const content = out === undefined ? "" : await masked(deps, out);
	run.emit({
		type: "verify.completed",
		payload: { gate: gateName(gate), ok: out === undefined, details: content },
	});
	return out === undefined ? undefined : { kind: "failed", content };
};

/** Runs the gates in template order and stops at the first that does not pass. */
export const verifyGates = async (deps: StepDeps, run: Run): Promise<Gated> => {
	for (const gate of run.gates) {
		const gated = await one(deps, gate, run);
		if (gated) return gated;
	}
	return { kind: "passed" };
};
