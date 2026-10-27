import type {
	ApprovalInput,
	EngineError,
	MeteEvent,
	RunView,
	TeamEngineAdapter,
} from "@mete/contracts";
import type { EventBus } from "@mete/kernel";

import {
	eventLine,
	exitCode,
	historyLine,
	namesOf,
	statusLines,
	waitsForHuman,
} from "../domain/format.js";
import { type App, engineOf, notReadyLines } from "../infrastructure/app.js";
import { runHistory } from "../infrastructure/history.js";
import {
	type AllowScope,
	allowAndResume,
	askScope,
	canAlways,
	waitForAsk,
} from "./allow.js";
import { hintAt, noteStart, watchPauses } from "./run-hints.js";

// The mete commands (ARCHITECTURE.md, CLI). Each returns the process exit code.

/** The terminal as the commands see it. */
export type Io = {
	readonly out: (line: string) => void;
	readonly err: (line: string) => void;
	/** Reads a secret without echo, or standard input when it is not a terminal. */
	readonly readSecret: (prompt: string) => Promise<string>;
	/** Asks one line on the terminal; undefined when the user gave up. Absent when standard input is not a terminal. */
	readonly readLine?: (prompt: string) => Promise<string | undefined>;
	/** Calls `fn` on Ctrl+C until the returned function is called. */
	readonly onInterrupt: (fn: () => void) => () => void;
};

type Ended = RunView["status"];

type Followed = {
	target: string | undefined;
	/** Task titles by Task id, from task.created. */
	titles: Map<string, string>;
	/** The pause reason or the failure code of the run's last stop. */
	why: string | undefined;
	done: (status: Ended) => void;
};

const whyOf = (e: MeteEvent) => {
	if (e.type === "run.paused") return e.payload.reason;
	return e.type === "run.failed" ? e.payload.code : undefined;
};

// Without a run id it follows the first run created after it subscribed: a CLI starts one run.
const show = (f: Followed, io: Io, e: MeteEvent) => {
	if (f.target === undefined && e.type === "run.created") f.target = e.runId;
	if (e.runId === undefined || e.runId !== f.target) return;
	if (e.type === "task.created" && e.taskId)
		f.titles.set(e.taskId, e.payload.title);
	const line = eventLine(e, (id) => f.titles.get(id));
	if (line) io.out(line);
	hintAt(io, e);
	f.why = whyOf(e) ?? f.why;
	const end = endOf(e);
	if (end) f.done(end);
};

const FOLLOWED = [
	"run.*",
	"agent.*",
	"checkpoint.*",
	"task.*",
	"approval.*",
	"review.*",
	"artifact.*",
] as const;

// Prints the run's events until it ends or pauses for anything but quota or network, which wait here.
// `titles` comes from the run's history, so a new terminal names tasks it never saw created.
const follow = (
	events: EventBus,
	io: Io,
	resume?: string,
	titles: ReadonlyMap<string, string> = new Map(),
) => {
	const f: Followed = {
		target: resume,
		titles: new Map(titles),
		why: undefined,
		done: () => {},
	};
	const ended = new Promise<Ended>((resolve) => {
		const subs = FOLLOWED.map((p) =>
			events.subscribe(p, (e) => show(f, io, e)),
		);
		f.done = (status) => {
			for (const s of subs) s.dispose();
			resolve(status);
		};
	});
	return { ended, runId: () => f.target, why: () => f.why };
};

/** The end state a run event reaches, or undefined while the run goes on or waits on its own (quota, network). */
export const endOf = (e: MeteEvent): Ended | undefined => {
	if (e.type === "run.completed") return "completed";
	if (e.type === "run.failed") return "failed";
	if (e.type === "run.cancelled") return "cancelled";
	if (
		e.type === "run.paused" &&
		e.payload.reason !== "quota" &&
		e.payload.reason !== "network"
	)
		return "paused";
	return undefined;
};

// A tool call the policy asks about is answered with mete allow (ARCHITECTURE.md, CLI; ADR-121);
// resume would repeat the call, which asks again.
const allowHint = (runId: string, always: boolean) => [
	"The policy asks before this call. Allow it once with:",
	`  mete allow ${runId}`,
	"or for the rest of the run with:",
	`  mete allow ${runId} --run`,
	...(always ? ["or for good with:", `  mete allow ${runId} --always`] : []),
];

export const withEngine = async (
	app: App,
	io: Io,
	use: (engine: TeamEngineAdapter) => Promise<number>,
) => {
	const engine = engineOf(app);
	if (engine.ok) return use(engine.value);
	for (const line of notReadyLines(app, engine.error)) io.err(line);
	return 1;
};

const teamHint = (runId: string | undefined) => [
	"A team task waits for you. Approve it with:",
	`  mete approve ${runId} [<task id>]`,
	"or send it back with feedback:",
	`  mete revise ${runId} <task id> "<feedback>"`,
];

/** What a run command does: start a run, resume one, answer a team task or a policy ask and go on. */
export type RunWhat =
	| { goal: string; templateId?: string | null; continue?: true }
	| { resume: string }
	| { approve: string; input: ApprovalInput }
	| { allow: string; scope: AllowScope };

const targetOf = (what: RunWhat) => {
	if ("resume" in what) return what.resume;
	if ("approve" in what) return what.approve;
	return "allow" in what ? what.allow : undefined;
};

const begin = (app: App, engine: TeamEngineAdapter, what: RunWhat) => {
	if ("resume" in what) return engine.resume(what.resume);
	if ("approve" in what) return engine.approve(what.approve, what.input);
	if ("allow" in what)
		return allowAndResume(app, engine, what.allow, what.scope);
	// null asks for a single agent; no templateId lets the router decide (docs/08, Router).
	const template =
		what.templateId !== undefined ? { templateId: what.templateId } : {};
	// --continue without a goal takes the handoff's goal (docs/08, Run memory).
	const goal = what.goal ? { goal: what.goal } : {};
	const more = what.continue ? { continue: true as const } : {};
	return engine.start({ ...goal, ...template, ...more });
};

// A start that did not start: the router's suggestions exit 2 like a pause, the rest exits 1.
const refused = (io: Io, e: EngineError) => {
	io.err(e.message);
	if (e.code !== "choose_template") return 1;
	for (const id of e.suggestions)
		io.err(`  mete run --template ${id} "<goal>"`);
	io.err('  mete run --single "<goal>"');
	return 2;
};

// SECURITY.md (Autonomy levels): level 3 asks for worktrees and verify gates. A single-agent run has neither,
// and a team run has worktrees only while vcs.git@2 is active, so only those runs say so.
const LEVEL_THREE_NOTE =
	"autonomy 3: verify gates and worktrees are not available yet (SECURITY.md); the run goes on with checkpoints only";

const noteLevelThree = (
	io: Io,
	registry: App["registry"],
	engine: TeamEngineAdapter,
	runId?: string,
) => {
	const view = runId ? engine.status(runId) : undefined;
	const run = view?.ok === true ? view.value[0] : undefined;
	const inWorktree = run?.templateId != null && registry.has("vcs.git@2");
	if (run?.autonomyLevel === 3 && !inWorktree) io.err(LEVEL_THREE_NOTE);
};

/** `mete run` (a goal, --template, --resume), `mete approve`, `mete revise` and `mete allow`. */
export const runCommand = (app: App, io: Io, what: RunWhat): Promise<number> =>
	withEngine(app, io, async (engine) => {
		const target = targetOf(what);
		const seen = target ? runHistory(app.registry, target) : undefined;
		const titles = namesOf(seen?.events ?? []).titles;
		const run = follow(app.events, io, target, titles);
		if ("goal" in what) noteStart(app, io);
		const r = await begin(app, engine, what);
		if (!r.ok) return refused(io, r.error);
		const hints = watchPauses(app, io, run.runId);
		noteLevelThree(io, app.registry, engine, run.runId());
		const stopWatching = cancelOnInterrupt(io, engine, run.runId);
		const status = await run.ended;
		stopWatching();
		await hints.printed();
		hints.stop();
		return settle(app, io, status, { runId: run.runId(), why: run.why() });
	});

// After the run stopped: a policy-ask pause is answered, any other end explained.
const settle = async (
	app: App,
	io: Io,
	status: Ended,
	{ runId, why }: { runId: string | undefined; why: string | undefined },
) => {
	// A single agent has no tasks, so its history never waits for the human.
	const history = runId ? runHistory(app.registry, runId) : undefined;
	const human = waitsForHuman(history?.events ?? []);
	const asks = status === "paused" && why === "approval" && !human;
	if (asks && runId) return answerAsk(app, io, runId);
	explain(io, status, { runId, why, human });
	return exitCode(status);
};

// A policy-ask pause: the ask is printed, which masking may publish after the pause; a terminal is
// asked, and an answer allows and follows the run again, while anything else leaves it paused.
const answerAsk = async (app: App, io: Io, runId: string): Promise<number> => {
	const asked = await waitForAsk(app, runId);
	if (asked) io.out(eventLine(asked) ?? "");
	const scope =
		asked && io.readLine
			? await askScope(io.readLine, asked.payload)
			: undefined;
	if (scope) return runCommand(app, io, { allow: runId, scope });
	const always = asked !== undefined && canAlways(asked.payload);
	for (const line of allowHint(runId, always)) io.err(line);
	return exitCode("paused");
};

// Nothing awaits the handler, so a throwing cancel is reported; Ctrl+C again retries it.
const cancelOnInterrupt = (
	io: Io,
	engine: TeamEngineAdapter,
	runId: () => string | undefined,
) =>
	io.onInterrupt(() => {
		const id = runId();
		if (!id) return;
		engine.cancel(id).catch((e: unknown) => {
			const why = e instanceof Error ? e.message : String(e);
			io.err(`could not cancel the run: ${why}`);
		});
	});

const KEY_HINT =
	"A provider refused its API key. Check the keys with: mete key list";

// What the user can do about a run that stopped without completing.
const explain = (
	io: Io,
	status: Ended,
	{
		runId,
		why,
		human,
	}: { runId?: string | undefined; why?: string | undefined; human: boolean },
) => {
	if (status === "failed" && why === "unauthorized") io.err(KEY_HINT);
	if (status !== "paused") return;
	// A policy ask, the other approval pause, is answered before this (answerAsk).
	if (why === "approval" && human)
		for (const line of teamHint(runId)) io.err(line);
	else io.err(`Resume it with: mete run --resume ${runId}`);
};

/**
 * `mete events <run id>`: the run's persisted history, one line per event: when, what, which
 * module, which task and agent role. A row that no longer parses is reported, never skipped.
 */
export const eventsCommand = (
	app: App,
	io: Io,
	runId: string,
	json = false,
) => {
	const h = runHistory(app.registry, runId);
	if (!h) {
		io.err("storage.sql@1 is not active, so no events can be read");
		return 1;
	}
	if (h.events.length === 0 && h.broken.length === 0) {
		io.err(`no events for run ${runId}`);
		return 1;
	}
	// --json: the shape of mete/events (ARCHITECTURE.md, Daemon protocol).
	if (json)
		io.out(
			JSON.stringify(
				{ events: h.events, unreadable: h.broken.length },
				null,
				2,
			),
		);
	const names = namesOf(h.events);
	if (!json) for (const e of h.events) io.out(historyLine(e, names));
	for (const b of h.broken)
		io.err(`event ${b.seq} cannot be read: ${b.issues}`);
	return h.broken.length > 0 ? 1 : 0;
};

/** `mete status [<run id>] [--json]`; --json prints the RunView list mete/status answers. */
export const statusCommand = (app: App, io: Io, runId?: string, json = false) =>
	withEngine(app, io, async (engine) => {
		const r = engine.status(runId);
		if (!r.ok) {
			io.err(r.error.message);
			return 1;
		}
		if (json) io.out(JSON.stringify(r.value, null, 2));
		else for (const line of statusLines(r.value)) io.out(line);
		return 0;
	});

/**
 * `mete mcp`: serves the workspace's teams to an MCP host until it closes stdin or Ctrl+C.
 * stdout carries only the protocol, so every line here goes to stderr.
 */
export const mcpCommand = (
	app: App,
	io: Io,
	workspaceDir: string,
	closed: Promise<void>,
) =>
	withEngine(app, io, async () => {
		io.err(`serving METE over MCP for ${workspaceDir}`);
		await new Promise<void>((resolve) => {
			const stop = io.onInterrupt(resolve);
			void closed.then(resolve).finally(stop);
		});
		return 0;
	});

/** `mete stop <run id>` or `mete stop --all`: cancels paused runs. */
export const stopCommand = (app: App, io: Io, target: string | "all") =>
	withEngine(app, io, async (engine) => {
		const listed = engine.status(target === "all" ? undefined : target);
		if (!listed.ok) {
			io.err(listed.error.message);
			return 1;
		}
		let code = 0;
		for (const run of listed.value)
			if (run.status === "paused" || target !== "all")
				code = Math.max(code, await stopOne(engine, io, run));
		return code;
	});

// A run that is not paused is skipped by --all and refused when named.
const stopOne = async (engine: TeamEngineAdapter, io: Io, run: RunView) => {
	if (run.status !== "paused") {
		io.err(
			`${run.id} is ${run.status}; a running run stops with Ctrl+C in its mete run`,
		);
		return 1;
	}
	const r = await engine.cancel(run.id);
	io.out(r.ok ? `${run.id} cancelled` : r.error.message);
	return r.ok ? 0 : 1;
};
