import type { LlmChunk } from "@mete/contracts";
import { compacted, foldable, type Split } from "../domain/compact.js";
import { afterModelError, type EventBody } from "../domain/run-events.js";
import type { AgentRef } from "../domain/run-machine.js";
import { activeRole, activeSeat } from "../domain/team-run.js";
import { runPreferOf } from "./pinned.js";
import { apply, type EngineState, emitAs, type Live } from "./run-state.js";
import type { ModelOutcome } from "./steps.js";
import { applyWorker } from "./task-worker.js";
import { listenWorker, ownsWorker, type WorkerCall } from "./worker-call.js";

type ModelChunk = Extract<LlmChunk, { type: "model" }>;

const modelEvent = (
	call: WorkerCall,
	agent: AgentRef | undefined,
	chunk: ModelChunk,
): EventBody => {
	const { roleId } = activeRole(call.context);
	const to = { providerId: chunk.providerId, modelId: chunk.modelId };
	if (!agent)
		return {
			type: "agent.created",
			payload: { roleId, ...to, tier: activeSeat(call.context).tier },
		};
	const prefer = runPreferOf(call.context, roleId);
	const reason =
		chunk.reason === "first" &&
		prefer?.providerId === to.providerId &&
		prefer.modelId === to.modelId
			? "user"
			: chunk.reason;
	const from = { providerId: agent.providerId, modelId: agent.modelId };
	return { type: "agent.model.changed", payload: { from, to, reason } };
};

const modelChanged = (
	state: EngineState,
	live: Live,
	call: WorkerCall,
	chunk: ModelChunk,
) => {
	if (!ownsWorker(live, call)) return;
	const agent = live.snapshot.context.team?.tasks[call.task]?.session?.agent;
	if (agent?.providerId === chunk.providerId && agent.modelId === chunk.modelId)
		return;
	const { roleId } = activeRole(call.context);
	const next = {
		id: call.as.agentId,
		roleId,
		providerId: chunk.providerId,
		modelId: chunk.modelId,
		...(chunk.family ? { family: chunk.family } : {}),
		...(chunk.contextWindow ? { contextWindow: chunk.contextWindow } : {}),
	};
	if (applyWorker(state, live, call.task, { type: "MODEL", agent: next }))
		emitAs(state, live, modelEvent(call, agent, chunk), call.as);
};

/** Persists buffered model selections between coordinator steps, never from a stream callback. */
export const flushWorkerModel = (
	state: EngineState,
	live: Live,
	call: WorkerCall,
) => {
	const chunks = call.chunks.splice(0);
	listenWorker(call);
	for (const chunk of call.split ? [] : chunks)
		modelChanged(state, live, call, chunk);
};

const endedThinking = (state: EngineState, live: Live, call: WorkerCall) => {
	const result = call.result;
	const usage =
		result?.kind === "outcome" && result.out.kind === "replied"
			? result.out.usage
			: undefined;
	if (!call.split)
		emitAs(
			state,
			live,
			{ type: "agent.thinking.ended", payload: usage ? { usage } : {} },
			call.as,
		);
};

const failedCall = (
	state: EngineState,
	live: Live,
	call: WorkerCall,
	out: Exclude<ModelOutcome, { kind: "replied" }>,
) => {
	apply(state, live, { type: "RELEASE", id: call.reservation });
	if (out.kind === "error" && out.error.code === "too_large" && !call.split) {
		const older = foldable(call.context.messages);
		if (older) return older;
	}
	const at = state.deps.now();
	apply(
		state,
		live,
		out.kind === "missing"
			? { type: "PAUSE", at, reason: "no_model" }
			: afterModelError(out.error, at),
	);
	return undefined;
};

/** Commits one buffered outcome against current state; returns older turns to fold after too_large. */
export const settleWorker = (
	state: EngineState,
	live: Live,
	call: WorkerCall,
): Split | undefined => {
	const result = call.result;
	if (!result) return undefined;
	const owned = ownsWorker(live, call);
	if (owned) flushWorkerModel(state, live, call);
	endedThinking(state, live, call);
	if (!ownsWorker(live, call)) return undefined;
	if (result.kind === "thrown") throw result.error;
	if (result.kind === "stale") {
		apply(state, live, { type: "RELEASE", id: call.reservation });
		return undefined;
	}
	const out = result.out;
	if (out.kind === "replied") return keepReply(state, live, call, out);
	return failedCall(state, live, call, out);
};

const keepReply = (
	state: EngineState,
	live: Live,
	call: WorkerCall,
	out: Extract<ModelOutcome, { kind: "replied" }>,
): undefined => {
	if (!call.split) {
		applyWorker(state, live, call.task, {
			type: "REPLIED",
			message: out.message,
			finish: out.finish,
			reservation: call.reservation,
		});
		return undefined;
	}
	const summary =
		out.message.content.trim() ||
		"(No summary could be made of the earlier turns.)";
	if (!out.message.content.trim())
		state.deps.logger.warn(
			{ runId: live.meta.id },
			"empty summary; older turns dropped",
		);
	applyWorker(state, live, call.task, {
		type: "SUMMARIZED",
		messages: compacted(call.split, summary),
		reservation: call.reservation,
	});
	const payload = { messages: call.split.middle.length, chars: summary.length };
	emitAs(state, live, { type: "run.summarized", payload }, call.as);
	return undefined;
};
