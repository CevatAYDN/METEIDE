import {
	type EngineError,
	err,
	ok,
	PolicySchema,
	type Result,
	type RunStart,
	RunStartSchema,
	ShellConfigSchema,
	shellName,
	type TeamEngineAdapter,
} from "@mete/contracts";
import type { ConfigInvalid } from "@mete/kernel";
import { initialTransition } from "xstate";
import { z } from "zod";
import type { Budget } from "../domain/next-step.js";
import { openingMessages } from "../domain/prompt.js";
import { runMachine } from "../domain/run-machine.js";
import {
	apply,
	clearTimer,
	drive,
	type EngineDeps,
	type EngineState,
	emit,
	hold,
	iso,
	type Live,
} from "./run-driver.js";

// team.engine@1 for single-agent runs (docs/06 engine types, docs/07 Run state machine, docs/08 Single agent).

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

// The policy's autonomy and budget (SECURITY.md); there is no template budget yet.
const policy = (
	s: EngineState,
): Result<{ autonomy: 0 | 1 | 2 | 3; budget: Budget }, EngineError> => {
	const p = s.deps.config.get("policy", PolicySchema);
	if (!p.ok) return err(fromConfig(p.error));
	const b = p.value.budget;
	const budget = {
		cloudRequests: b.cloud_requests_per_run,
		maxHours: b.max_hours,
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

const begin = (
	s: EngineState,
	goal: string,
	priority: 0 | 1 | 2,
): Result<{ runId: string }, EngineError> => {
	const p = policy(s);
	if (!p.ok) return p;
	const shell = s.deps.config.get("shell", ShellConfigSchema);
	if (!shell.ok) return err(fromConfig(shell.error));
	const where = {
		os: s.deps.os,
		shell: shellName(shell.value, s.deps.platform),
	};
	const messages = openingMessages(goal, where);
	const [snapshot] = initialTransition(runMachine, {
		goal,
		priority,
		messages,
	});
	const at = s.deps.now();
	const meta = {
		id: s.deps.newId(),
		workspaceId: s.deps.workspaceId,
		autonomyLevel: p.value.autonomy,
		budget: p.value.budget,
		createdAt: iso(at),
	};
	s.deps.store.save(meta, snapshot);
	const l = hold(s, meta, snapshot);
	emit(s, l, { type: "run.created", payload: { templateId: null, goal } });
	apply(s, l, { type: "START", at });
	drive(s, l);
	return ok({ runId: meta.id });
};

const start = async (s: EngineState, req: RunStart): Out<{ runId: string }> => {
	const r = RunStartSchema.safeParse(req);
	if (!r.success)
		return err({ code: "bad_input", message: z.prettifyError(r.error) });
	if (r.data.templateId)
		return err({
			code: "not_supported",
			message: "team templates come with the team engine (Phase 2)",
		});
	return begin(s, r.data.goal, r.data.priority);
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
	const p = policy(s);
	if (!p.ok) return p;
	l.value.meta = { ...l.value.meta, budget: p.value.budget };
	clearTimer(l.value);
	apply(s, l.value, { type: "RESUME", at: s.deps.now() });
	drive(s, l.value);
	return ok(undefined);
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
const quotaReset = (s: EngineState, runId: string) => {
	const log = (fields: Record<string, unknown>) =>
		s.deps.logger.error(
			{ runId, ...fields },
			"run not resumed at the quota reset",
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

/** Creates team.engine@1; the module calls `recover` when it activates and `stop` when it deactivates. */
export const createEngine = (deps: EngineDeps) => {
	const s: EngineState = {
		deps,
		live: new Map(),
		onQuotaReset: (runId) => quotaReset(s, runId),
	};
	const engine: TeamEngineAdapter = {
		start: (req) => start(s, req),
		pause: (runId) => pause(s, runId),
		resume: (runId) => resume(s, runId),
		cancel: (runId) => cancel(s, runId),
		status: (runId) => status(s, runId),
	};
	return { engine, recover: () => recover(s), stop: () => stop(s) };
};

export type { EngineDeps };
