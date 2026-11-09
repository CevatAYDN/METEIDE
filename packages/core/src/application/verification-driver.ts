import { attemptId } from "../domain/attempts.js";
import type { RunContext } from "../domain/run-types.js";
import { taskContext } from "../domain/task-worker.js";
import { applyTask } from "../domain/team.js";
import { verifyOf } from "../domain/team-run.js";
import {
	reportSha256,
	verificationAttemptNumber,
} from "../domain/verification.js";
import { waitForPolicy } from "./policy-wait.js";
import {
	apply,
	type EngineState,
	emit,
	type Live,
	toolContext,
} from "./run-state.js";
import { type StrictGated, verifyStrict } from "./strict-verification.js";
import {
	beginVerification,
	interruptVerification,
	recordVerification,
} from "./verification.js";

/** Blocks an uncertain or unavailable strict check without changing a user/quota pause. */
export const blockVerification = (
	state: EngineState,
	live: Live,
	task: string,
) => {
	if (!["running", "paused"].includes(live.snapshot.value)) return;
	const team = live.snapshot.context.team;
	if (!team) return;
	const blocked = applyTask(team, task, {
		type: "BLOCK",
		reason: "verification",
	});
	if (
		blocked.team === team ||
		!apply(state, live, { type: "TEAM", team: blocked.team })
	)
		return;
	if (blocked.change)
		emit(
			state,
			live,
			{ type: "task.status.changed", payload: blocked.change },
			team.tasks[task]?.id,
		);
};

const holdPrior = (state: EngineState, live: Live, task: string) => {
	const evaluation = live.snapshot.context.team?.tasks[task]?.verification;
	if (
		!evaluation?.gates.some(
			(row) =>
				row.status === "running" ||
				(row.status === "not_run" && row.reason === "interrupted"),
		)
	)
		return false;
	interruptVerification(state, live, task);
	const current = live.snapshot.context.team?.tasks[task]?.verification;
	if (current?.evaluationId === evaluation.evaluationId)
		blockVerification(state, live, task);
	return true;
};

const afterStrict = async (
	state: EngineState,
	live: Live,
	task: string,
	input: {
		result: StrictGated;
		context: RunContext | undefined;
		active: () => boolean;
	},
) => {
	const { result, context, active } = input;
	if (!active()) return false;
	if (result.kind === "passed") return true;
	if (
		result.kind === "approval" &&
		context &&
		(await waitForPolicy(state, live, context, "verify"))
	)
		return false;
	if (!active()) return false;
	if (result.kind === "failed") {
		const current = live.snapshot.context.team;
		if (current)
			apply(state, live, {
				type: "REPAIR",
				team: current,
				content: result.content,
			});
	} else if (result.kind === "approval")
		apply(state, live, {
			type: "PAUSE",
			at: state.deps.now(),
			reason: "approval",
		});
	else blockVerification(state, live, task);
	return false;
};

/** Resumes the same report cycle; authoritative worker replies clear proof before a fresh cycle. */
export const strictVerified = async (
	state: EngineState,
	live: Live,
	task: string,
	report: string,
) => {
	const team = live.snapshot.context.team;
	if (!team) return false;
	const token = live.token;
	const context = taskContext(live.snapshot.context, task);
	if (holdPrior(state, live, task)) return false;
	const prior = team.tasks[task]?.verification;
	const reusable =
		prior?.attemptId === attemptId(team, task) &&
		prior.attemptNumber === verificationAttemptNumber(team, task) &&
		prior.reportSha256 === reportSha256(report);
	const evaluation = reusable
		? prior
		: await beginVerification(state, live, task, report);
	if (!evaluation) return false;
	const active = () =>
		live.token === token &&
		live.snapshot.value === "running" &&
		live.snapshot.context.task === task &&
		live.snapshot.context.team?.tasks[task]?.verification?.evaluationId ===
			evaluation.evaluationId;
	const result = await verifyStrict(state.deps, {
		gates: verifyOf(team, task),
		rows: evaluation.gates,
		ctx: toolContext(live),
		active,
		emit: (body) => emit(state, live, body, team.tasks[task]?.id),
		save: (row) =>
			recordVerification(state, live, task, {
				evaluationId: evaluation.evaluationId,
				result: row,
			}),
	});
	return afterStrict(state, live, task, { result, context, active });
};
