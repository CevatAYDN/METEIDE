import {
	type EngineError,
	err,
	ok,
	type Result,
	type TaskControlAdapter,
	type TaskControlAnswer,
	TaskControlAnswerSchema,
	TaskPendingInputSchema,
	TaskPendingResultSchema,
} from "@mete/contracts";
import { currentWait } from "../domain/task-wait.js";
import { controlTurn } from "./control-turn.js";
import { retiring } from "./quiesce.js";
import type { EngineState, Live } from "./run-state.js";
import { masked } from "./steps.js";
import { answerTask, staleTaskRequest } from "./task-answers.js";
import { syncHumanWaits } from "./task-waits.js";

type Controls = {
	readonly find: (id: string) => Result<Live, EngineError>;
	readonly resume: (id: string) => Promise<Result<void, EngineError>>;
};
const badInput = (): Result<never, EngineError> =>
	err({ code: "bad_input", message: "Invalid task-control request." });
const parsedPending = (text: string) => {
	try {
		const parsed = TaskPendingResultSchema.safeParse(JSON.parse(text));
		return parsed.success ? parsed.data : undefined;
	} catch {
		return undefined;
	}
};

const answerInTurn = async (
	state: EngineState,
	live: Live,
	input: { controls: Controls; answer: TaskControlAnswer },
) => {
	if (state.quiescing) return retiring();
	if (live.meta.id !== input.answer.runId) return staleTaskRequest();
	const answered = answerTask(state, live, input.answer);
	if (!answered.ok) return answered;
	const snapshot = live.snapshot;
	return snapshot.value === "paused" &&
		snapshot.context.pause?.reason === "approval"
		? input.controls.resume(input.answer.runId)
		: ok(undefined);
};

const pending = async (state: EngineState, live: Live) => {
	const requests = await controlTurn(live, () => {
		if (!["running", "paused"].includes(live.snapshot.value)) return [];
		syncHumanWaits(state, live);
		return Object.values(live.snapshot.context.team?.tasks ?? {}).flatMap(
			(entry) => currentWait(entry)?.request ?? [],
		);
	});
	const parsed = parsedPending(
		await masked(state.deps, JSON.stringify({ requests })),
	);
	if (!parsed)
		return err<EngineError>({
			code: "failed",
			message: "Pending task data could not be read.",
		});
	if (!["running", "paused"].includes(live.snapshot.value))
		return ok({ requests: [] });
	const current = new Set(
		Object.values(live.snapshot.context.team?.tasks ?? {}).flatMap(
			(entry) => currentWait(entry)?.request.requestId ?? [],
		),
	);
	return ok({
		requests: parsed.requests.filter((r) => current.has(r.requestId)),
	});
};

/** Additive exact task control; the legacy engine port keeps its own input contract. */
export const createTaskControl = (
	state: EngineState,
	controls: Controls,
): TaskControlAdapter => ({
	async pending(input) {
		const parsed = TaskPendingInputSchema.safeParse(input);
		if (!parsed.success) return badInput();
		const live = controls.find(parsed.data.runId);
		return live.ok ? pending(state, live.value) : live;
	},
	async answer(input) {
		const parsed = TaskControlAnswerSchema.safeParse(input);
		if (!parsed.success) return badInput();
		if (state.quiescing) return retiring();
		const live = controls.find(parsed.data.runId);
		if (!live.ok) return live;
		return controlTurn(live.value, () =>
			answerInTurn(state, live.value, { controls, answer: parsed.data }),
		);
	},
});
