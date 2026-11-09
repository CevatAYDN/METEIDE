import { isDeepStrictEqual } from "node:util";
import {
	err,
	ok,
	type TaskVerificationAdapter,
	TaskVerificationInputSchema,
	TaskVerificationResultSchema,
	type VerificationEvaluation,
	VerificationEvaluationSchema,
	type VerificationGate,
} from "@mete/contracts";
import { attemptId } from "../domain/attempts.js";
import { verifyOf } from "../domain/team-run.js";
import type { TeamState } from "../domain/team-schema.js";
import {
	reportSha256,
	verificationAttemptNumber,
	withVerification,
} from "../domain/verification.js";
import { gateName } from "../domain/verify.js";
import {
	apply,
	type EngineState,
	emit,
	iso,
	type Live,
	loaded,
} from "./run-state.js";
import { masked } from "./steps.js";

const evaluationsOf = (entry: TeamState["tasks"][string]) => {
	const evaluations = new Map<string, VerificationEvaluation>();
	const currentAttemptId = entry.attempts?.id ?? entry.id;
	for (const record of entry.attempts?.finished ?? []) {
		const evaluation =
			record.id === currentAttemptId ? entry.verification : record.verification;
		if (evaluation) evaluations.set(record.id, evaluation);
	}
	if (entry.verification)
		evaluations.set(entry.verification.attemptId, entry.verification);
	return [...evaluations.values()];
};

const verificationResult = (team: TeamState) => ({
	mode: team.verificationVersion === 1 ? "strict" : "legacy",
	tasks: team.template.tasks.flatMap((task) => {
		const entry = team.tasks[task.id];
		return entry
			? [
					{
						taskId: entry.id,
						templateTaskId: task.id,
						title: task.title,
						currentAttemptId: attemptId(team, task.id),
						evaluations: evaluationsOf(entry),
					},
				]
			: [];
	}),
});

/** Reads persisted snapshots without holding or driving the run, masking at the read boundary. */
export const createVerification = (
	state: EngineState,
): TaskVerificationAdapter => ({
	async read(input) {
		const parsed = TaskVerificationInputSchema.safeParse(input);
		if (!parsed.success)
			return err({
				code: "bad_input",
				message: "Invalid verification request.",
			});
		const stored = loaded(state, parsed.data.runId);
		if (!stored.ok) return stored;
		if (!stored.value)
			return err({ code: "not_found", message: "The run does not exist." });
		const team = stored.value.snapshot.context.team;
		if (!team)
			return err({
				code: "not_supported",
				message: "Single-agent runs have no task verification.",
			});
		try {
			const result = verificationResult(team);
			return ok(
				TaskVerificationResultSchema.parse(
					JSON.parse(await masked(state.deps, JSON.stringify(result))),
				),
			);
		} catch {
			return err({
				code: "failed",
				message: "Verification evidence could not be read.",
			});
		}
	},
});

const initialGates = (state: EngineState, team: TeamState, task: string) =>
	Promise.all(
		verifyOf(team, task).map(
			async (gate, index): Promise<VerificationGate> => ({
				index,
				gate: await masked(state.deps, gateName(gate)),
				optional: "optional" in gate && gate.optional === true,
				status: "not_run",
				reason: "not_reached",
				details: "",
			}),
		),
	);

/** Initializes every row before dispatch; every report cycle receives a fresh evaluation id. */
export const beginVerification = async (
	state: EngineState,
	live: Live,
	task: string,
	report: string,
) => {
	const team = live.snapshot.context.team;
	const entry = team?.tasks[task];
	if (!team || !entry) return undefined;
	const token = live.token;
	const gates = await initialGates(state, team, task);
	if (!refreshVerificationSnapshot(state, live)) return undefined;
	const current = live.snapshot.context.team;
	if (
		live.token !== token ||
		live.snapshot.value !== "running" ||
		!current ||
		current.tasks[task] !== entry
	)
		return undefined;
	const evaluation = VerificationEvaluationSchema.parse({
		evaluationId: state.deps.newId(),
		attemptId: attemptId(team, task),
		attemptNumber: verificationAttemptNumber(team, task),
		reportSha256: reportSha256(report),
		startedAt: iso(state.deps.now()),
		gates,
	});
	return apply(state, live, {
		type: "TEAM",
		team: withVerification(current, task, evaluation),
	})
		? evaluation
		: undefined;
};

const pendingRow = (
	evaluation: VerificationEvaluation,
	result: VerificationGate,
) => {
	const row = evaluation.gates[result.index];
	return (
		!!row &&
		row.gate === result.gate &&
		row.optional === result.optional &&
		(row.status === "running" ||
			(row.status === "not_run" &&
				(row.reason === "not_reached" || row.reason === "approval_required")))
	);
};

/** Adopts authoritative persisted changes and retires the old token without reopening a terminal run. */
export const refreshVerificationSnapshot = (state: EngineState, live: Live) => {
	if (!["running", "paused"].includes(live.snapshot.value)) return undefined;
	const stored = state.deps.store.load(live.meta.id);
	if (!stored) return undefined;
	// JSON removes omitted optional fields; deep comparison ignores parser property ordering.
	if (
		stored.snapshot.value !== live.snapshot.value ||
		!isDeepStrictEqual(
			JSON.parse(JSON.stringify(stored.snapshot.context)),
			JSON.parse(JSON.stringify(live.snapshot.context)),
		)
	) {
		live.snapshot = stored.snapshot;
		live.token = {};
	}
	return stored;
};

const currentEvaluation = (
	state: EngineState,
	live: Live,
	task: string,
	input: { evaluationId: string; result: VerificationGate },
) => {
	const held = live.snapshot.context.team?.tasks[task]?.verification;
	const stored = refreshVerificationSnapshot(state, live);
	if (!stored) return undefined;
	if (!["running", "paused"].includes(live.snapshot.value)) return undefined;
	const team = stored?.snapshot.context.team;
	const evaluation = team?.tasks[task]?.verification;
	if (
		!team ||
		!evaluation ||
		held?.evaluationId !== input.evaluationId ||
		evaluation.evaluationId !== input.evaluationId ||
		evaluation.attemptId !== attemptId(team, task)
	)
		return undefined;
	if (!pendingRow(evaluation, input.result)) return undefined;
	return { team: live.snapshot.context.team ?? team, evaluation };
};

/** Stores only matching nonterminal evidence; a known result during pause remains readable. */
export const recordVerification = (
	state: EngineState,
	live: Live,
	task: string,
	input: { evaluationId: string; result: VerificationGate },
) => {
	const current = currentEvaluation(state, live, task, input);
	if (!current) return false;
	const { team, evaluation } = current;
	const next = VerificationEvaluationSchema.parse({
		...evaluation,
		gates: evaluation.gates.map((row) =>
			row.index === input.result.index ? input.result : row,
		),
	});
	const updated = withVerification(team, task, next);
	if (!apply(state, live, { type: "TEAM", team: updated })) return false;
	const payload = {
		evaluationId: next.evaluationId,
		attemptId: next.attemptId,
		index: input.result.index,
	};
	emit(state, live, { type: "verify.updated", payload }, team.tasks[task]?.id);
	if (
		input.result.status !== "running" &&
		["running", "paused"].includes(live.snapshot.value)
	)
		emit(
			state,
			live,
			{
				type: "verify.evaluated",
				payload: {
					...payload,
					attemptNumber: next.attemptNumber,
					result: input.result,
				},
			},
			team.tasks[task]?.id,
		);
	return true;
};

/** Seals only pending rows; completed evidence is never replaced by uncertainty. */
export const interruptVerification = (
	state: EngineState,
	live: Live,
	task: string,
) => {
	const evaluation = live.snapshot.context.team?.tasks[task]?.verification;
	if (!evaluation) return;
	for (const row of evaluation.gates)
		if (row.status === "running")
			recordVerification(state, live, task, {
				evaluationId: evaluation.evaluationId,
				result: {
					index: row.index,
					gate: row.gate,
					optional: row.optional,
					status: "not_run",
					reason: "interrupted",
					details:
						"The gate was interrupted; inspect its effects before retrying.",
				},
			});
};

/** Seals uncertain dispatches before CANCEL, so a late callback cannot mutate a terminal run. */
export const cancelVerification = (state: EngineState, live: Live) => {
	const team = live.snapshot.context.team;
	if (team?.verificationVersion !== 1) return;
	for (const task of Object.keys(team.tasks))
		interruptVerification(state, live, task);
};
