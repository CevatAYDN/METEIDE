import {
	type ChatMessage,
	type LlmChunk,
	TIER_MIN_CONTEXT,
} from "@mete/contracts";
import { attemptOf } from "../domain/attempts.js";
import { foldable, toSummarize } from "../domain/compact.js";
import { type NextStep, nextStep } from "../domain/next-step.js";
import { guarded } from "../domain/repeat.js";
import { afterModelError } from "../domain/run-events.js";
import { pinnedFor } from "../domain/skill-pinned.js";
import { withSkillMessages } from "../domain/skill-prompt.js";
import { skillLoadSpecs } from "../domain/skill-tool.js";
import { currentWait } from "../domain/task-wait.js";
import { activeRole, activeSeat, isAsking } from "../domain/team-run.js";
import { allowed } from "../domain/tools.js";
import { mayWrite } from "../domain/write-call.js";
import { answered, asked } from "./clarify.js";
import { runTurn } from "./control-turn.js";
import { judged } from "./judge.js";
import { schedule, schedulerState } from "./parallel-scheduler.js";
import { pinnedSeat, runPreferOf } from "./pinned.js";
import { waitForPolicy } from "./policy-wait.js";
import {
	apply,
	type EngineState,
	emit,
	type Live,
	toolContext,
} from "./run-state.js";
import { stopScheduler } from "./scheduler-drain.js";
import { ensureCatalog } from "./skill-catalog.js";
import { ensureExplicitSkills } from "./skill-explicit.js";
import { skillBoundary } from "./skill-guard.js";
import { skillToolTurn } from "./skill-tool.js";
import { callModel, callTool, type ModelOutcome } from "./steps.js";
import { cutTurn, summarizeTurn } from "./summarize.js";
import { syncHumanWaits } from "./task-waits.js";
import { submit, teamTurn, verdict } from "./team-driver.js";
import { checkpoint, keeping } from "./tool-checkpoint.js";

// The loop that moves a running run step by step (docs/08, Single agent), as module-level
// functions over the engine's state record; a team run moves between tasks in team-driver.

const owns = (l: Live, token: object) =>
	l.token === token && l.snapshot.value === "running";

type ModelChunk = Extract<LlmChunk, { type: "model" }>;

// The agent a model chunk names: the run's, the task's or a new one, on the chunk's model and family.
const agentOf = (s: EngineState, l: Live, c: ModelChunk) => {
	const { roleId, agentId, taskId } = activeRole(l.snapshot.context);
	return {
		id:
			l.snapshot.context.agent?.id ?? l.nextAgent ?? agentId ?? s.deps.newId(),
		...(taskId ? { roleId } : {}),
		providerId: c.providerId,
		modelId: c.modelId,
		...(c.family ? { family: c.family } : {}),
		...(c.contextWindow ? { contextWindow: c.contextWindow } : {}),
	};
};

// agent.created for the first model, agent.model.changed when a later call uses another one.
const onModel = (s: EngineState, l: Live, c: ModelChunk) => {
	const agent = l.snapshot.context.agent;
	const { roleId, taskId } = activeRole(l.snapshot.context);
	const to = { providerId: c.providerId, modelId: c.modelId };
	if (agent?.providerId === to.providerId && agent.modelId === to.modelId)
		return;
	const next = agentOf(s, l, c);
	if (!apply(s, l, { type: "MODEL", agent: next })) return; // a done run
	if (!agent) {
		const { tier } = activeSeat(l.snapshot.context);
		// The attempt of a best-of-N task this agent works (ADR-162).
		const attempt = attemptOf(l.snapshot.context);
		const payload = { roleId, ...to, tier, ...(attempt ? { attempt } : {}) };
		return emit(s, l, { type: "agent.created", payload }, taskId);
	}
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
	// A call before the agent exists names the agent it makes: the task's worker keeps its id, a
	// reviewer, an answerer, a judge or the single agent gets a new one, kept until the agent is made,
	// so a first call that failed and runs again names the same agent (docs/07).
	// shortcut: a restart forgets the kept id, so a retry after one names a new agent.
	if (!l.snapshot.context.agent)
		l.nextAgent =
			activeRole(l.snapshot.context).agentId ?? l.retryAgent ?? s.deps.newId();
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
		l.retryAgent = l.snapshot.context.agent ? undefined : l.nextAgent;
		l.nextAgent = undefined;
	}
};

// MCP descriptions and schemas are external input before the first tool result.
const taintForMcp = (
	s: EngineState,
	l: Live,
	seat: Awaited<ReturnType<typeof pinnedSeat>>,
) =>
	!(
		allowed(seat, "mcp.tools@1") &&
		s.deps.registry.has("mcp.tools@1") &&
		!apply(s, l, { type: "TAINT" })
	);

// Everything a model call needs first; false when the run stopped owning this turn meanwhile.
// Legacy and manual-mode turns stay synchronous: the catalog is fetched only when it is due.
const prepareCall = (
	s: EngineState,
	l: Live,
	token: object,
	seat: Awaited<ReturnType<typeof pinnedSeat>>,
): boolean | Promise<boolean> => {
	if (!owns(l, token)) return false;
	const catalog = ensureCatalog(s, l, () => owns(l, token));
	if (catalog === true) return taintForMcp(s, l, seat);
	if (catalog === false) return false;
	return catalog.then((ready) => ready && taintForMcp(s, l, seat));
};

const modelTurn = async (s: EngineState, l: Live, token: object) => {
	// The pin is read before the call starts: a run paused while it is read never calls the model.
	const seat = await pinnedSeat(s, l);
	const prepared = prepareCall(s, l, token, seat);
	if (prepared === false || (prepared !== true && !(await prepared))) return;
	const model = new AbortController();
	l.model = model;
	const signal = AbortSignal.any([l.all.signal, model.signal]);
	const { priority, messages } = l.snapshot.context;
	const task = activeRole(l.snapshot.context).taskId;
	const run = {
		runId: l.meta.id,
		priority,
		messages: withSkillMessages(messages, pinnedFor(l.snapshot.context)),
		seat,
		native: skillLoadSpecs(l.snapshot.context),
	};
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

// The result with the repeat line when it repeats (ADR-166); the transcript reads past the line, so the log names it.
const repeatChecked = (
	s: EngineState,
	l: Live,
	t: ToolStep,
	message: Extract<ChatMessage, { role: "tool" }>,
) => {
	const checked = guarded(l.snapshot.context.messages, t.call, message);
	if (checked !== message)
		s.deps.logger.info(
			{ runId: l.meta.id, tool: t.call.name },
			"a tool call gave the same result again; the model is told so",
		);
	return checked;
};

// A finished tool call is kept even when the run was paused meanwhile (docs/08).
const pauseForPolicy = async (s: EngineState, l: Live, token: object) => {
	// Policy refused before effects: this is not an uncertain write on recovery.
	apply(s, l, { type: "TOOL_STARTED", callId: undefined });
	if (await waitForPolicy(s, l, l.snapshot.context)) return;
	if (owns(l, token))
		apply(s, l, { type: "PAUSE", at: s.deps.now(), reason: "approval" });
};

const toolTurn = async (
	s: EngineState,
	l: Live,
	token: object,
	t: ToolStep,
) => {
	if (await skillToolTurn(s, l, token, t.call)) return;
	if (t.checkpoint && !(await checkpoint(s, l, () => owns(l, token), t.step)))
		return;
	// A writing call is on record before it runs, so a crash in it is not run again (ADR-177).
	if (
		mayWrite(t.call) &&
		!apply(s, l, { type: "TOOL_STARTED", callId: t.call.id })
	)
		return;
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
			message: repeatChecked(s, l, t, out.message),
			...(out.external ? { external: true } : {}),
		});
	else await pauseForPolicy(s, l, token);
};

// A reply that ends a conversation: a judge's choice, a review's verdict, a task's report, or a single
// agent's summary.
const finish = async (s: EngineState, l: Live, reply: string) => {
	const c = l.snapshot.context;
	if (c.judge) return judged(s, l, reply);
	if (c.review) return verdict(s, l, reply);
	if (c.clarify) return answered(s, l, reply);
	if (isAsking(c)) return asked(s, l, reply);
	if (c.team) return submit(s, l, reply);
	apply(s, l, { type: "COMPLETE", at: s.deps.now(), summary: reply });
};

const nextModel = async (s: EngineState, l: Live, token: object) => {
	const prepared = ensureExplicitSkills(s, l, token, l.snapshot.context);
	if (prepared !== true) {
		await prepared;
		return;
	}
	cutTurn(s, l);
	const ctx = l.snapshot.context;
	const window =
		ctx.agent?.contextWindow ?? TIER_MIN_CONTEXT[activeSeat(ctx).tier];
	const older = toSummarize(ctx.messages, window, pinnedFor(ctx));
	if (older) return summarizeTurn(s, l, older, () => owns(l, token));
	return modelTurn(s, l, token);
};

// A team run whose active task is not in progress or in review moves between tasks first.
const step = async (s: EngineState, l: Live, token: object) => {
	const c = l.snapshot.context;
	// A best-of-N task between attempts is in progress with no agent yet (ADR-162).
	const entry = c.task ? c.team?.tasks[c.task] : undefined;
	const working =
		entry?.status === "in_progress" &&
		entry.context.agentId &&
		!currentWait(entry);
	if (c.team && !c.review && !working) return teamTurn(s, l, c.team);
	const at = s.deps.now();
	const next = nextStep(c, l.meta.budget, at);
	if (next.kind === "model") return nextModel(s, l, token);
	if (next.kind === "tool") return toolTurn(s, l, token, next);
	if (next.kind === "complete") return finish(s, l, next.summary);
	apply(s, l, { type: "PAUSE", at, reason: next.reason });
};

const failLoop = (s: EngineState, l: Live, token: object, error: unknown) => {
	// A throwing adapter is a bug; only the error name is kept, as for module.crashed (docs/06).
	const known = [
		"Error",
		"TypeError",
		"RangeError",
		"SyntaxError",
		"ReferenceError",
		"URIError",
		"EvalError",
		"AggregateError",
	];
	const message =
		error instanceof Error && known.includes(error.name) ? error.name : "Error";
	s.deps.logger.error(
		{ errorType: message, runId: l.meta.id },
		"run step threw",
	);
	const fail = { type: "FAIL", code: "internal", message } as const;
	try {
		if (l.token === token) apply(s, l, { ...fail, at: s.deps.now() });
	} catch {
		// The row cannot be written either (a busy database); the run stays as last saved.
		s.deps.logger.error({ runId: l.meta.id }, "run not failed");
	}
};

// One turn: the S2 boundary first, so neither the parallel scheduler nor a step dispatches
// unchecked work (ADR-190).
const turn = async (
	s: EngineState,
	l: Live,
	token: object,
	scheduler: ReturnType<typeof schedulerState>,
) => {
	if (!owns(l, token)) return;
	// A legacy run gets `true` without an await, so its turn timing is unchanged.
	const boundary = skillBoundary(s, l, () => owns(l, token));
	if (!(boundary === true || (boundary !== false && (await boundary)))) return;
	syncHumanWaits(s, l);
	if (await schedule(s, l, scheduler)) return;
	if (owns(l, token)) await step(s, l, token);
};

const loop = async (s: EngineState, l: Live, token: object) => {
	const scheduler = schedulerState();
	try {
		while (owns(l, token)) {
			await runTurn(l, () => turn(s, l, token, scheduler));
		}
	} catch (e) {
		failLoop(s, l, token, e);
	} finally {
		try {
			await stopScheduler(s, l, scheduler);
		} catch (error) {
			failLoop(s, l, token, error);
		}
	}
};

/** Starts a drive loop for a running run, after the previous loop stopped. */
export const drive = (s: EngineState, l: Live) => {
	const token = {};
	l.token = token;
	// A tool call the previous loop still awaits listens to the previous controller: cancel or stop
	// aborting the new one must reach it too (ADR-065).
	const previous = l.all;
	l.all = new AbortController();
	l.all.signal.addEventListener("abort", () => previous.abort(), {
		once: true,
	});
	l.loop = l.loop.catch(() => undefined).then(() => loop(s, l, token));
};
