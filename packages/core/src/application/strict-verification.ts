import {
	type ShellExecOutput,
	TOOL_CATALOG,
	type ToolContext,
	type VerificationGate,
} from "@mete/contracts";
import { z } from "zod";
import { gateEligible } from "../domain/verification.js";
import { validVerificationOutput } from "../domain/verification-output.js";
import {
	type Gate,
	gateError,
	gateFailure,
	ShellRunSchema,
} from "../domain/verify.js";
import { type Emit, masked, runCapability, type StepDeps } from "./steps.js";

type Run = {
	gates: readonly Gate[];
	rows: readonly VerificationGate[];
	ctx: ToolContext;
	emit: Emit;
	active: () => boolean;
	save: (result: VerificationGate) => boolean;
};

/** Strict progression never treats uncertainty, approval or actual failure as optional. */
export type StrictGated =
	| { kind: "passed" | "blocked" | "approval" | "interrupted" }
	| { kind: "failed"; content: string };

const ResultSchema = z.discriminatedUnion("ok", [
	z.object({ ok: z.literal(true), value: z.unknown() }),
	z.object({
		ok: z.literal(false),
		error: z.object({ code: z.string(), message: z.string() }),
	}),
]);

const StrictShellOutputSchema = ShellRunSchema.extend({
	os: z.string(),
	shell: z.string(),
}) satisfies z.ZodType<ShellExecOutput>;

const notRun = (
	row: VerificationGate,
	reason: Extract<VerificationGate, { status: "not_run" }>["reason"],
	details: string,
): VerificationGate => ({
	index: row.index,
	gate: row.gate,
	optional: row.optional,
	status: "not_run",
	reason,
	details,
});
const completed = (
	row: VerificationGate,
	status: "passed" | "failed",
	details: string,
): VerificationGate => ({
	index: row.index,
	gate: row.gate,
	optional: row.optional,
	status,
	details,
});

const failure = (
	row: VerificationGate,
	error: { code: string; message: string },
): VerificationGate => {
	if (
		error.code === "capability_missing" ||
		error.code === "denied" ||
		error.code === "approval_required"
	)
		return notRun(row, error.code, error.message);
	if (error.code === "aborted")
		return notRun(row, "interrupted", error.message);
	return completed(row, "failed", gateError(row.gate, error.message));
};

const commandOutput = (
	row: VerificationGate,
	value: unknown,
): VerificationGate => {
	const parsed = StrictShellOutputSchema.safeParse(value);
	if (!parsed.success)
		return completed(
			row,
			"failed",
			"shell.exec@1 returned an unexpected result",
		);
	if (parsed.data.exitCode === null && !parsed.data.timedOut)
		return notRun(row, "interrupted", "The gate command was interrupted.");
	const failed = gateFailure(row.gate, parsed.data);
	return completed(
		row,
		failed ? "failed" : "passed",
		failed ?? JSON.stringify(parsed.data),
	);
};

const output = (
	gate: Gate,
	row: VerificationGate,
	value: unknown,
): VerificationGate => {
	if ("run" in gate || gate.capability === "shell.exec@1")
		return commandOutput(row, value);
	if (!validVerificationOutput(gate.capability, value, gate.args))
		return completed(
			row,
			"failed",
			"The capability returned an unexpected result.",
		);
	return completed(row, "passed", JSON.stringify(value) ?? "");
};

const execute = async (
	deps: StepDeps,
	run: Run,
	gate: Gate,
	row: VerificationGate,
) => {
	const ref = "run" in gate ? "shell.exec@1" : gate.capability;
	const input = "run" in gate ? { command: gate.run } : (gate.args ?? {});
	const schema = TOOL_CATALOG.find((entry) => entry.ref === ref)?.schema;
	if (schema && !schema.safeParse(input).success)
		return completed(row, "failed", "The gate arguments are invalid.");
	try {
		const raw: unknown = await runCapability(
			deps,
			{ ref, input },
			run.ctx,
			run.emit,
		);
		const parsed = ResultSchema.safeParse(raw);
		if (!parsed.success)
			return completed(
				row,
				"failed",
				"The adapter returned an invalid result.",
			);
		return parsed.data.ok
			? output(gate, row, parsed.data.value)
			: failure(row, parsed.data.error);
	} catch {
		return completed(row, "failed", "The gate adapter threw an error.");
	}
};

const one = async (
	deps: StepDeps,
	run: Run,
	gate: Gate,
	row: VerificationGate,
) => {
	if (Object.hasOwn(gate, "expect"))
		return notRun(
			row,
			"unsupported_expect",
			"The expect language is not supported.",
		);
	if (!run.active() || run.ctx.signal.aborted)
		return notRun(row, "interrupted", "");
	const running: VerificationGate = {
		index: row.index,
		gate: row.gate,
		optional: row.optional,
		status: "running",
		details: "",
	};
	if (!run.save(running) || !run.active() || run.ctx.signal.aborted)
		return undefined;
	return execute(deps, run, gate, row);
};

const verdict = (row: VerificationGate): StrictGated | undefined => {
	if (row.status === "not_run" && row.reason === "approval_required")
		return { kind: "approval" };
	if (row.status === "failed") return { kind: "failed", content: row.details };
	return gateEligible(row) ? undefined : { kind: "blocked" };
};

const advance = async (
	deps: StepDeps,
	run: Run,
	at: { gate: Gate; row: VerificationGate },
): Promise<StrictGated | undefined> => {
	if (!run.active() || run.ctx.signal.aborted) return { kind: "interrupted" };
	if (gateEligible(at.row)) return undefined;
	if (at.row.status === "failed")
		return { kind: "failed", content: at.row.details };
	if (
		at.row.status === "running" ||
		(at.row.status === "not_run" && at.row.reason === "interrupted")
	)
		return { kind: "blocked" };
	const result = await one(deps, run, at.gate, at.row);
	if (!result) return { kind: "interrupted" };
	const safe = { ...result, details: await masked(deps, result.details) };
	if (!run.save(safe) || !run.active()) return { kind: "interrupted" };
	return verdict(safe);
};

/** Executes in template order, checking ownership before every next dispatch. */
export const verifyStrict = async (
	deps: StepDeps,
	run: Run,
): Promise<StrictGated> => {
	for (const [index, gate] of run.gates.entries()) {
		const row = run.rows[index];
		if (!row) return { kind: "blocked" };
		const result = await advance(deps, run, { gate, row });
		if (result) return result;
	}
	return { kind: "passed" };
};
