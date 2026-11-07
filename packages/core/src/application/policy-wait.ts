import {
	PolicyPendingResultSchema,
	type PolicyRequest,
	type PolicyRequestsAdapter,
} from "@mete/contracts";
import type { RunContext } from "../domain/run-types.js";
import type { EngineState, Live } from "./run-state.js";
import type { StepDeps } from "./steps.js";
import { suspendTaskContinuation } from "./task-continuation.js";
import { setTaskWait, waitIdentity } from "./task-waits.js";

/** Reads the one server-owned ask for this exact task agent, never the latest run event. */
export const readPolicyRequest = async (
	deps: StepDeps,
	runId: string,
	agentId: string,
): Promise<PolicyRequest | undefined> => {
	const port =
		deps.registry.resolve<PolicyRequestsAdapter>("policy.requests@1");
	if (!port.ok) return undefined;
	const result = await port.value[0].impl.pending({ runId, agentId });
	if (!result.ok) return undefined;
	const parsed = PolicyPendingResultSchema.safeParse(result.value);
	if (!parsed.success) return undefined;
	const matching = parsed.data.requests.filter(
		(r) => r.runId === runId && r.agentId === agentId,
	);
	return matching.length === 1 ? matching[0] : undefined;
};

/** Parks a task only after the caller has retained its exact current security request. */
export const parkPolicyRequest = (
	state: EngineState,
	live: Live,
	context: RunContext,
	input: { request: PolicyRequest; stage?: "tool" | "verify" | "setup" },
): boolean => {
	const task = context.task;
	const entry = task ? live.snapshot.context.team?.tasks[task] : undefined;
	if (!task || !entry) return false;
	if (
		live.all.signal.aborted ||
		!["running", "paused"].includes(live.snapshot.value)
	)
		return false;
	const request = input.request;
	const coordinator = context.review || context.clarify || context.judge;
	const agentId = coordinator ? context.agent?.id : entry.context.agentId;
	if (request.runId !== live.meta.id || request.agentId !== agentId)
		return false;
	suspendTaskContinuation(state, live, context);
	setTaskWait(state, live, task, {
		stage: input.stage ?? "tool",
		request: {
			...waitIdentity(live, task),
			agentId: request.agentId,
			requestId: request.requestId,
			kind: "policy",
			ask: request.ask,
			rule: request.rule,
		},
	});
	return true;
};

/** Sequential tools and verify gates use the same exact task-local waiting path. */
export const waitForPolicy = async (
	state: EngineState,
	live: Live,
	context: RunContext,
	stage: "tool" | "verify" | "setup" = "tool",
) => {
	const task = context.task;
	const agentId =
		context.agent?.id ??
		(task ? context.team?.tasks[task]?.context.agentId : undefined);
	if (!task || !agentId) return false;
	const request = await readPolicyRequest(state.deps, live.meta.id, agentId);
	return request
		? parkPolicyRequest(state, live, context, { request, stage })
		: false;
};
