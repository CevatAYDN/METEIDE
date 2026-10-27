import type { LlmChunk } from "@mete/contracts";
import { foldable, toSummarize } from "../domain/compact.js";
import { type NextStep, nextStep } from "../domain/next-step.js";
import { afterModelError } from "../domain/run-events.js";
import { activeRole, activeSeat } from "../domain/team-run.js";
import { pinnedSeat, runPreferOf } from "./pinned.js";
import {
	apply,
	type EngineState,
	emit,
	type Live,
	toolContext,
} from "./run-state.js";
import { callModel, callTool, type ModelOutcome } from "./steps.js";
import { summarizeTurn } from "./summarize.js";
import { submit, teamTurn, verdict } from "./team-driver.js";
import { createCheckpoint } from "./vcs-steps.js";

// The loop that moves a running run step by step (docs/08, Single agent), as module-level
// functions over the engine's state record; a team run moves between tasks in team-driver.

const owns = (l: Live, token: object) =>
	l.token === token && l.snapshot.value === "running";

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
			{
				type: "agent.created",
				payload: { roleId, ...to, tier: activeSeat(l.snapshot.context).tier },
			},
			taskId,
		);
	const from = { providerId: agent.providerId, modelId: agent.modelId };
	// A user's preference is the reason only when this call used it (ADR-122); a chain that fell
	// past it keeps the gateway's own reason, and a workspace pin (ADR-077) is no user choice here.
	const prefer = runPreferOf(l.snapshot.context, roleId);
	const reason =
		c.reason === "first" &&
		prefer?.providerId === to.providerId &&
		prefer.modelId === to.modelId
			? "user"
			: c.reason;
	const payload = { from, to, reason };
	emit(s, l, { type: "agent.model.changed", payload }, taskId);
};

// One model call between agent.thinking.started and agent.thinking.ended; the end carries the
// call's token counts when the call finished (ADR-090).
const think = async (
	s: EngineState,
	l: Live,
	call: {
		readonly run: Parameters<typeof callModel>[1];
		readonly task: string | undefined;
		readonly signal: AbortSignal;
	},
) => {
	emit(s, l, { type: "agent.thinking.started", payload: {} }, call.task);
	let usage: Extract<ModelOutcome, { kind: "replied" }>["usage"] | undefined;
	try {
		const out = await callModel(
			s.deps,
			call.run,
			(m) => onModel(s, l, m),
			call.signal,
		);
		if (out.kind === "replied") usage = out.usage;
		return out;
	} finally {
		l.model = undefined;
		const payload = usage ? { usage } : {};
		emit(s, l, { type: "agent.thinking.ended", payload }, call.task);
	}
};

const modelTurn = async (s: EngineState, l: Live, token: object) => {
	// The pin is read before the call starts: a run paused while it is read never calls the model.
	const seat = await pinnedSeat(s, l);
	if (!owns(l, token)) return;
	const model = new AbortController();
	l.model = model;
	const signal = AbortSignal.any([l.all.signal, model.signal]);
	const { priority, messages } = l.snapshot.context;
	const task = activeRole(l.snapshot.context).taskId;
	const run = { runId: l.meta.id, priority, messages, seat };
	const out = await think(s, l, { run, task, signal });
	if (!owns(l, token)) return; // paused or cancelled meanwhile: the reply is dropped
	const at = s.deps.now();
	// A request too large for every model folds the older turns once and is asked again; with
	// nothing left to fold it pauses like no model (ADR-056, docs/08).
	const older =
		out.kind === "error" && out.error.code === "too_large"
			? foldable(messages)
			: undefined;
	if (older) return summarizeTurn(s, l, older, () => owns(l, token));
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
	const cp = await createCheckpoint(s.deps, {
		...toolContext(l),
		runId: l.meta.id,
	});
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
	const snapshot = cp.value ? undefined : await openSnapshot(s, l, t.step);
	if (snapshot && !snapshot.ok) {
		const fail = { code: "checkpoint_failed", message: snapshot.error.message };
		if (owns(l, token))
			apply(s, l, { type: "FAIL", at: s.deps.now(), ...fail });
		return false;
	}
	apply(s, l, {
		type: "CHECKPOINTED",
		step: t.step,
		...(snapshot?.value ? { snapshot: snapshot.value } : {}),
	});
	return owns(l, token);
};

// Without git, the step's file snapshot (ADR-080); none when the engine keeps no snapshots.
const openSnapshot = async (s: EngineState, l: Live, step: number) => {
	if (!s.deps.snapshots) return undefined;
	const opened = await s.deps.snapshots.open(l.meta.id, step);
	if (opened.ok)
		emit(s, l, {
			type: "checkpoint.created",
			payload: { kind: "snapshot", ref: opened.value },
		});
	return opened;
};

// Copies a file into the step's snapshot before an fs tool writes it (ADR-080).
const keeping = (s: EngineState, l: Live) => {
	const ref = l.snapshot.context.snapshot;
	const store = s.deps.snapshots;
	return ref && store ? (path: string) => store.keep(ref, path) : undefined;
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
		{
			call: t.call,
			seat: activeSeat(l.snapshot.context),
			beforeWrite: keeping(s, l),
		},
		toolContext(l),
		(b) => emit(s, l, b, activeRole(l.snapshot.context).taskId),
	);
	if (out.kind === "result")
		apply(s, l, {
			type: "TOOL_DONE",
			message: out.message,
			...(out.external ? { external: true } : {}),
		});
	else if (owns(l, token))
		apply(s, l, { type: "PAUSE", at: s.deps.now(), reason: "approval" });
};

// A reply that ends a conversation: a review's verdict, a task's report, or a single agent's summary.
const finish = async (s: EngineState, l: Live, reply: string) => {
	const c = l.snapshot.context;
	if (c.review) return verdict(s, l, reply);
	if (c.team) return submit(s, l, reply);
	apply(s, l, { type: "COMPLETE", at: s.deps.now(), summary: reply });
};

// A team run whose active task is not in progress or in review moves between tasks first.
const step = async (s: EngineState, l: Live, token: object) => {
	const c = l.snapshot.context;
	const working = c.task && c.team?.tasks[c.task]?.status === "in_progress";
	if (c.team && !c.review && !working) return teamTurn(s, l, c.team);
	const at = s.deps.now();
	const next = nextStep(c, l.meta.budget, at);
	if (next.kind === "model") {
		const older = toSummarize(c.messages, activeSeat(c).tier);
		if (older) return summarizeTurn(s, l, older, () => owns(l, token));
		return modelTurn(s, l, token);
	}
	if (next.kind === "tool") return toolTurn(s, l, token, next);
	if (next.kind === "complete") return finish(s, l, next.summary);
	apply(s, l, { type: "PAUSE", at, reason: next.reason });
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
