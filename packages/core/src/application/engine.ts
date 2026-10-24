import {
	type ApprovalInput,
	type EngineError,
	err,
	ok,
	PolicySchema,
	type Result,
	type RunStart,
	RunStartSchema,
	type TeamEngineAdapter,
} from "@mete/contracts";
import type { ConfigInvalid } from "@mete/kernel";
import { initialTransition, transition } from "xstate";
import { z } from "zod";
import type { Budget } from "../domain/next-step.js";
import { openingMessages } from "../domain/prompt.js";
import { runMachine } from "../domain/run-machine.js";
import { type TeamState, teamOf } from "../domain/team.js";
import {
	loadTemplate,
	type TemplateError,
} from "../infrastructure/template-store.js";
import { recordDecision } from "./approvals.js";
import { type Opening, offerBrief, takeHandoff } from "./continue.js";
import { createCheckpointRestore } from "./restore.js";
import { pruneOldCheckpoints } from "./retention.js";
import { routeFor } from "./route.js";
import { drive } from "./run-driver.js";
import {
	apply,
	clearTimer,
	type EngineDeps,
	type EngineState,
	emit,
	hold,
	iso,
	type Live,
	platformOf,
} from "./run-state.js";
import { announce } from "./spawned.js";

// team.engine@2 (docs/06 engine types, docs/07 Run state machine, docs/08 Single agent and teams).

type Out<T> = Promise<Result<T, EngineError>>;

const fromConfig = (e: ConfigInvalid): EngineError => ({
	code: "bad_input",
	message: `${e.file}: ${e.path}: ${e.reason}`,
});

const invalid = (l: Live, call: string): Result<never, EngineError> =>
	err({
		code: "invalid_state",
		message: `cannot ${call} a ${l.snapshot.value} run`,
		status: l.snapshot.value,
	});

// The policy's autonomy and budget (SECURITY.md); a team run takes the lower of the policy's
// and its template's budget, so a template never raises the user's limit.
const policy = (
	s: EngineState,
	team?: TeamState,
): Result<{ autonomy: 0 | 1 | 2 | 3; budget: Budget }, EngineError> => {
	const p = s.deps.config.get("policy", PolicySchema);
	if (!p.ok) return err(fromConfig(p.error));
	const b = p.value.budget;
	const t = team?.template.budget;
	const budget = {
		cloudRequests: Math.min(
			b.cloud_requests_per_run,
			t?.cloud_requests ?? Infinity,
		),
		maxHours: Math.min(b.max_hours, t?.max_hours ?? Infinity),
	};
	return ok({ autonomy: p.value.autonomy, budget });
};

// A row whose snapshot cannot be read is not_found, so callers answer instead of throwing.
const loaded = (s: EngineState, runId: string) => {
	try {
		return ok(s.deps.store.load(runId));
	} catch (e) {
		const why = e instanceof Error ? e.name : "error";
		return err<EngineError>({
			code: "not_found",
			message: `run ${runId} cannot be read (${why})`,
		});
	}
};

const find = (s: EngineState, runId: string): Result<Live, EngineError> => {
	const held = s.live.get(runId);
	if (held) return ok(held);
	if (!z.uuid().safeParse(runId).success)
		return err({ code: "not_found", message: `no run ${runId}` });
	const row = loaded(s, runId);
	if (!row.ok) return row;
	return row.value
		? ok(hold(s, row.value.meta, row.value.snapshot))
		: err({ code: "not_found", message: `no run ${runId}` });
};

/** What begin() needs: the run id made before a handoff was taken, the goal, the opening. */
type Begin = {
	readonly id: string;
	readonly goal: string;
	readonly priority: 0 | 1 | 2;
	readonly team?: TeamState | undefined;
	readonly opening: Opening;
};

const begin = (
	s: EngineState,
	{ id, goal, priority, team, opening }: Begin,
): Result<{ runId: string }, EngineError> => {
	const p = policy(s, team);
	if (!p.ok) return p;
	const where = platformOf(s);
	if (!where.ok) return err(fromConfig(where.error));
	const brief = opening.brief;
	// A team task opens its own conversation when it starts (team-driver).
	const messages = team ? [] : openingMessages(goal, where.value, brief);
	const input = { goal, priority, messages, brief };
	const [fresh] = initialTransition(runMachine, input);
	const snapshot = team
		? transition(runMachine, fresh, { type: "TEAM", team })[0]
		: fresh;
	const at = s.deps.now();
	const meta = {
		id,
		workspaceId: s.deps.workspaceId,
		autonomyLevel: p.value.autonomy,
		budget: p.value.budget,
		createdAt: iso(at),
	};
	s.deps.store.save(meta, snapshot);
	const l = hold(s, meta, snapshot);
	const templateId = team?.template.metadata.id ?? null;
	emit(s, l, { type: "run.created", payload: { templateId, goal } });
	if (opening.accepted)
		emit(s, l, {
			type: "handoff.accepted",
			payload: { handoffId: opening.accepted, byRunId: id },
		});
	apply(s, l, { type: "START", at });
	if (team) created(s, l, team);
	drive(s, l);
	return ok({ runId: meta.id });
};

// task.created for every task, in template order, once the run started and before its first step.
const created = (s: EngineState, l: Live, team: TeamState) =>
	announce(
		s,
		l,
		team,
		team.template.tasks.map((t) => t.id),
	);

const fromTemplate = (e: TemplateError): EngineError =>
	e.code === "invalid_template"
		? { code: "bad_input", message: e.issues.join("; ") }
		: {
				code: e.code === "not_found" ? "not_found" : "bad_input",
				message: e.message,
			};

const start = async (s: EngineState, req: RunStart): Out<{ runId: string }> => {
	const r = RunStartSchema.safeParse(req);
	if (!r.success)
		return err({ code: "bad_input", message: z.prettifyError(r.error) });
	const id = s.deps.newId();
	// No template named: the router decides; null asks for a single agent (docs/08, Router).
	const { templateId, goal: asked, priority: p } = r.data;
	const routed =
		templateId === undefined && asked && !r.data.continue
			? await routeFor(s, { goal: asked, runId: id, priority: p })
			: ok(templateId);
	if (!routed.ok) return routed;
	const team = await teamFor(s, routed.value);
	if (!team.ok) return team;
	// The template is checked first, so a bad one never uses up a handoff.
	const opening = r.data.continue ? takeHandoff(s, id) : ok(offerBrief(s));
	if (!opening.ok) return opening;
	// The schema asks for a goal unless the run continues, and a handoff always names one.
	const goal = r.data.goal ?? opening.value.goal ?? "";
	const { priority } = r.data;
	return begin(s, {
		id,
		goal,
		priority,
		team: team.value,
		opening: opening.value,
	});
};

const teamFor = async (
	s: EngineState,
	templateId: string | null | undefined,
): Promise<Result<TeamState | undefined, EngineError>> => {
	if (!templateId) return ok(undefined);
	if (!s.deps.templates)
		return err({
			code: "not_supported",
			message: "no template folders are set",
		});
	const t = await loadTemplate(s.deps.templates, templateId);
	return t.ok ? ok(teamOf(t.value, s.deps.newId)) : err(fromTemplate(t.error));
};

const pause = async (s: EngineState, runId: string): Out<void> => {
	const l = find(s, runId);
	if (!l.ok) return l;
	if (!apply(s, l.value, { type: "PAUSE", at: s.deps.now(), reason: "user" }))
		return invalid(l.value, "pause");
	l.value.model?.abort(); // a tool call in flight finishes (docs/08)
	return ok(undefined);
};

// The budget is read again, so a raised budget clears a budget pause (docs/08).
const resume = async (s: EngineState, runId: string): Out<void> => {
	const l = find(s, runId);
	if (!l.ok) return l;
	if (!l.value.snapshot.can({ type: "RESUME", at: 0 }))
		return invalid(l.value, "resume");
	const p = policy(s, l.value.snapshot.context.team);
	if (!p.ok) return p;
	l.value.meta = { ...l.value.meta, budget: p.value.budget };
	clearTimer(l.value);
	apply(s, l.value, { type: "RESUME", at: s.deps.now() });
	drive(s, l.value);
	return ok(undefined);
};

// The human's decision clears the approval pause, so the run goes on at once (docs/07).
const approveRun = async (
	s: EngineState,
	runId: string,
	input: ApprovalInput,
): Out<void> => {
	const l = find(s, runId);
	if (!l.ok) return l;
	const recorded = recordDecision(s, l.value, input);
	if (!recorded.ok) return recorded;
	return resume(s, runId);
};

const cancel = async (s: EngineState, runId: string): Out<void> => {
	const l = find(s, runId);
	if (!l.ok) return l;
	if (!apply(s, l.value, { type: "CANCEL", at: s.deps.now() }))
		return invalid(l.value, "cancel");
	l.value.all.abort();
	clearTimer(l.value);
	return ok(undefined);
};

const status: (
	s: EngineState,
	runId?: string,
) => ReturnType<TeamEngineAdapter["status"]> = (s, runId) => {
	const runs = s.deps.store.list(runId);
	if (runId !== undefined && runs.length === 0)
		return err({ code: "not_found", message: `no run ${runId}` });
	return ok(runs);
};

// A queued run never started, so it starts and pauses at once; START is a no-op for a running one.
const pauseLeftOver = (s: EngineState, l: Live) => {
	const at = s.deps.now();
	apply(s, l, { type: "START", at });
	apply(s, l, { type: "PAUSE", at, reason: "user" });
};

/** Pauses, reason user, the runs an earlier process left queued or running (docs/07). */
// A damaged row is marked failed with a warning, so one bad run never keeps the module from activating.
const recover = (s: EngineState) => {
	for (const id of s.deps.store.unfinished()) {
		try {
			const l = find(s, id);
			if (l.ok) pauseLeftOver(s, l.value);
			else {
				s.deps.store.markFailed(id, iso(s.deps.now()));
				s.deps.logger.warn(
					{ runId: id, reason: l.error.message },
					"run failed",
				);
			}
		} catch (e) {
			s.deps.logger.warn({ err: e, runId: id }, "run not recovered");
		}
	}
};

// Nothing awaits the timer, so a failed or throwing resume is logged rather than lost.
const pauseEnded = (s: EngineState, runId: string) => {
	const log = (fields: Record<string, unknown>) =>
		s.deps.logger.error(
			{ runId, ...fields },
			"run not resumed when its pause ended",
		);
	resume(s, runId).then(
		(r) => {
			if (!r.ok) log({ code: r.error.code });
		},
		(e: unknown) => log({ err: e }),
	);
};

/** Pauses every running run, aborts what is in flight and waits for the loops to stop. */
const stop = async (s: EngineState) => {
	for (const l of s.live.values()) {
		apply(s, l, { type: "PAUSE", at: s.deps.now(), reason: "user" });
		l.all.abort();
		clearTimer(l);
	}
	await Promise.allSettled([...s.live.values()].map((l) => l.loop));
};

/**
 * Creates team.engine@2; the module calls `recover` when it activates in the process that drives runs
 * (it also prunes old checkpoints), and `stop` when it deactivates.
 */
export const createEngine = (deps: EngineDeps) => {
	const s: EngineState = {
		deps,
		live: new Map(),
		onPauseEnded: (runId) => pauseEnded(s, runId),
	};
	const engine: TeamEngineAdapter = {
		start: (req) => start(s, req),
		pause: (runId) => pause(s, runId),
		resume: (runId) => resume(s, runId),
		cancel: (runId) => cancel(s, runId),
		approve: (runId, input) => approveRun(s, runId, input),
		status: (runId) => status(s, runId),
	};
	return {
		engine,
		// Only the process that drives runs recovers them and prunes old checkpoints, so a command
		// that only reads (mete status, mete events) never removes refs a live run may still use.
		recover: () => {
			recover(s);
			void pruneOldCheckpoints(s.deps);
		},
		stop: () => stop(s),
		restore: createCheckpointRestore(deps),
	};
};

export type { EngineDeps };
