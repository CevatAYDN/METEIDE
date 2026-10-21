import type { LlmChunk, ToolContext } from "@mete/contracts";
import { type NextStep, nextStep } from "../domain/next-step.js";
import { afterModelError } from "../domain/run-events.js";
import { activeRole, activeSeat } from "../domain/team-run.js";
import { apply, type EngineState, emit, type Live } from "./run-state.js";
import { callModel, callTool, createCheckpoint } from "./steps.js";
import { submit, teamTurn, verdict } from "./team-driver.js";

// The loop that moves a running run step by step (docs/08, Single agent), as module-level
// functions over the engine's state record; a team run moves between tasks in team-driver.

const owns = (l: Live, token: object) =>
	l.token === token && l.snapshot.value === "running";

const toolContext = (l: Live): ToolContext => {
	const agent = l.snapshot.context.agent;
	const ids = agent ? { agentId: agent.id } : {};
	return { runId: l.meta.id, ...ids, signal: l.all.signal };
};

type ModelChunk = Extract<LlmChunk, { type: "model" }>;

// agent.created for the first model, agent.model.changed when a later call uses another one.
const onModel = (s: EngineState, l: Live, c: ModelChunk) => {
	const agent = l.snapshot.context.agent;
	const { roleId, agentId, taskId } = activeRole(l.snapshot.context);
	const to = { providerId: c.providerId, modelId: c.modelId };
	if (agent?.providerId === to.providerId && agent.modelId === to.modelId)
		return;
	const id = agent?.id ?? agentId ?? s.deps.newId();
	const next = { id, ...(taskId ? { roleId } : {}), ...to };
	if (!apply(s, l, { type: "MODEL", agent: next })) return; // a done run
	if (!agent)
		return emit(
			s,
			l,
			{ type: "agent.created", payload: { roleId, ...to } },
			taskId,
		);
	const from = { providerId: agent.providerId, modelId: agent.modelId };
	const payload = { from, to, reason: c.reason };
	emit(s, l, { type: "agent.model.changed", payload }, taskId);
};

const modelTurn = async (s: EngineState, l: Live, token: object) => {
	const model = new AbortController();
	l.model = model;
	const signal = AbortSignal.any([l.all.signal, model.signal]);
	const { priority, messages } = l.snapshot.context;
	const seat = activeSeat(l.snapshot.context);
	const task = activeRole(l.snapshot.context).taskId;
	const run = { runId: l.meta.id, priority, messages, seat };
	emit(s, l, { type: "agent.thinking.started", payload: {} }, task);
	const out = await callModel(
		s.deps,
		run,
		(m) => onModel(s, l, m),
		signal,
	).finally(() => {
		l.model = undefined;
		emit(s, l, { type: "agent.thinking.ended", payload: {} }, task);
	});
	if (!owns(l, token)) return; // paused or cancelled meanwhile: the reply is dropped
	const at = s.deps.now();
	if (out.kind === "missing")
		apply(s, l, { type: "PAUSE", at, reason: "no_model" });
	else if (out.kind === "error") apply(s, l, afterModelError(out.error, at));
	else
		apply(s, l, { type: "REPLIED", message: out.message, finish: out.finish });
};

type ToolStep = Extract<NextStep, { kind: "tool" }>;

// false when the checkpoint failed or the run stopped while it was made.
const checkpoint = async (
	s: EngineState,
	l: Live,
	token: object,
	t: ToolStep,
) => {
	const cp = await createCheckpoint(s.deps, l.meta.id, l.all.signal);
	if (!cp.ok) {
		const at = s.deps.now();
		const fail = { code: "checkpoint_failed", message: cp.error };
		if (owns(l, token)) apply(s, l, { type: "FAIL", at, ...fail });
		return false;
	}
	if (cp.value)
		emit(s, l, {
			type: "checkpoint.created",
			payload: { kind: "git", ref: cp.value },
		});
	apply(s, l, { type: "CHECKPOINTED", step: t.step });
	return owns(l, token);
};

// A finished tool call is kept even when the run was paused meanwhile (docs/08).
const toolTurn = async (
	s: EngineState,
	l: Live,
	token: object,
	t: ToolStep,
) => {
	if (t.checkpoint && !(await checkpoint(s, l, token, t))) return;
	const out = await callTool(
		s.deps,
		{ call: t.call, seat: activeSeat(l.snapshot.context) },
		toolContext(l),
		(b) => emit(s, l, b, activeRole(l.snapshot.context).taskId),
	);
	if (out.kind === "result")
		apply(s, l, { type: "TOOL_DONE", message: out.message });
	else if (owns(l, token))
		apply(s, l, { type: "PAUSE", at: s.deps.now(), reason: "approval" });
};

// A reply that ends a conversation: a review's verdict, a task's report, or a single agent's summary.
const finish = (s: EngineState, l: Live, reply: string) => {
	const c = l.snapshot.context;
	if (c.review) verdict(s, l, reply);
	else if (c.team) submit(s, l, reply);
	else apply(s, l, { type: "COMPLETE", at: s.deps.now(), summary: reply });
};

// A team run whose active task is not in progress or in review moves between tasks first.
const step = async (s: EngineState, l: Live, token: object) => {
	const c = l.snapshot.context;
	const working = c.task && c.team?.tasks[c.task]?.status === "in_progress";
	if (c.team && !c.review && !working) return teamTurn(s, l, c.team);
	const at = s.deps.now();
	const next = nextStep(c, l.meta.budget, at);
	if (next.kind === "model") return modelTurn(s, l, token);
	if (next.kind === "tool") return toolTurn(s, l, token, next);
	if (next.kind === "complete") finish(s, l, next.summary);
	else if (next.kind === "fail")
		apply(s, l, { type: "FAIL", at, code: next.code, message: next.message });
	else apply(s, l, { type: "PAUSE", at, reason: next.reason });
};

const loop = async (s: EngineState, l: Live, token: object) => {
	try {
		while (owns(l, token)) await step(s, l, token);
	} catch (e) {
		// A throwing adapter is a bug; only the error name is kept, as for module.crashed (docs/06).
		s.deps.logger.error({ err: e, runId: l.meta.id }, "run step threw");
		const message = e instanceof Error ? e.name : "Error";
		const fail = { type: "FAIL", code: "internal", message } as const;
		try {
			if (l.token === token) apply(s, l, { ...fail, at: s.deps.now() });
		} catch (again) {
			// The row cannot be written either (a busy database); the run stays as last saved.
			s.deps.logger.error({ err: again, runId: l.meta.id }, "run not failed");
		}
	}
};

/** Starts a drive loop for a running run, after the previous loop stopped. */
export const drive = (s: EngineState, l: Live) => {
	const token = {};
	l.token = token;
	l.all = new AbortController();
	l.loop = l.loop.catch(() => undefined).then(() => loop(s, l, token));
};
