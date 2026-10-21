import type {
	ApprovalInput,
	MeteEvent,
	RunView,
	SecretStore,
	TeamEngineAdapter,
} from "@mete/contracts";
import type { EventBus } from "@mete/kernel";
import { apiKeyName } from "@mete/providers";
import { eventLine, exitCode, statusLines } from "../domain/format.js";
import { type App, engineOf } from "../infrastructure/app.js";

// The mete commands (ARCHITECTURE.md, CLI). Each returns the process exit code.

/** The terminal as the commands see it. */
export type Io = {
	readonly out: (line: string) => void;
	readonly err: (line: string) => void;
	/** Reads a secret without echo, or standard input when it is not a terminal. */
	readonly readSecret: (prompt: string) => Promise<string>;
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
	"artifact.*",
] as const;

// Prints the run's events until it ends or pauses for anything but quota, which waits here.
const follow = (events: EventBus, io: Io, resume?: string) => {
	const f: Followed = {
		target: resume,
		titles: new Map(),
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

const endOf = (e: MeteEvent): Ended | undefined => {
	if (e.type === "run.completed") return "completed";
	if (e.type === "run.failed") return "failed";
	if (e.type === "run.cancelled") return "cancelled";
	if (e.type === "run.paused" && e.payload.reason !== "quota") return "paused";
	return undefined;
};

// A tool call the policy asks about clears through resume; the user can widen the policy
// (ARCHITECTURE.md, CLI). A team task that waits for the human is answered with approve or revise.
const APPROVAL_HINT = [
	"The agent needs an approval for a tool call.",
	"The built-in policy keeps shell.exec@1 at level 1. To let it run allow-listed commands,",
	'add  overrides: { "shell.exec@1": 2 }  to .mete/policy.yaml.',
];

const withEngine = async (
	app: App,
	io: Io,
	use: (engine: TeamEngineAdapter) => Promise<number>,
) => {
	const engine = engineOf(app);
	if (engine.ok) return use(engine.value);
	for (const line of engine.error) io.err(line);
	if (app.inactive.some((m) => m.moduleId.startsWith("provider-")))
		io.err("Add a provider key with: mete key set openrouter");
	return 1;
};

const teamHint = (runId: string | undefined) => [
	"A team task waits for you. Approve it with:",
	`  mete approve ${runId} [<task id>]`,
	"or send it back with feedback:",
	`  mete revise ${runId} <task id> "<feedback>"`,
];

/** What a run command does: start a run, resume one, or answer a team task and go on. */
export type RunWhat =
	| { goal: string; templateId?: string }
	| { resume: string }
	| { approve: string; input: ApprovalInput };

const targetOf = (what: RunWhat) =>
	"resume" in what ? what.resume : "approve" in what ? what.approve : undefined;

const begin = (engine: TeamEngineAdapter, what: RunWhat) => {
	if ("resume" in what) return engine.resume(what.resume);
	if ("approve" in what) return engine.approve(what.approve, what.input);
	const template = what.templateId ? { templateId: what.templateId } : {};
	return engine.start({ goal: what.goal, ...template });
};

/** `mete run` (a goal, --template, --resume), `mete approve` and `mete revise`. */
export const runCommand = (app: App, io: Io, what: RunWhat) =>
	withEngine(app, io, async (engine) => {
		const run = follow(app.events, io, targetOf(what));
		const r = await begin(engine, what);
		if (!r.ok) {
			io.err(r.error.message);
			return 1;
		}
		const stopWatching = cancelOnInterrupt(io, engine, run.runId);
		const status = await run.ended;
		stopWatching();
		const runId = run.runId();
		const view = runId ? engine.status(runId) : undefined;
		const team = view?.ok === true && view.value[0]?.templateId != null;
		explain(io, status, { runId, why: run.why(), team });
		return exitCode(status);
	});

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
		team,
	}: { runId?: string | undefined; why?: string | undefined; team: boolean },
) => {
	if (status === "failed" && why === "unauthorized") io.err(KEY_HINT);
	if (status !== "paused") return;
	const answer = why === "approval" && team;
	const lines = answer
		? teamHint(runId)
		: why === "approval"
			? APPROVAL_HINT
			: [];
	for (const line of lines) io.err(line);
	if (!answer) io.err(`Resume it with: mete run --resume ${runId}`);
};

/** `mete status [<run id>]`. */
export const statusCommand = (app: App, io: Io, runId?: string) =>
	withEngine(app, io, async (engine) => {
		const r = engine.status(runId);
		if (!r.ok) {
			io.err(r.error.message);
			return 1;
		}
		for (const line of statusLines(r.value)) io.out(line);
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

const PROVIDER =
	/^(nvidia|openrouter|opencode-zen|custom:[a-z0-9]+(-[a-z0-9]+)*)$/;
const BUILT_IN = ["nvidia", "openrouter", "opencode-zen"];

const listKeys = async (secrets: SecretStore, io: Io) => {
	for (const id of BUILT_IN) {
		const r = await secrets.get(apiKeyName(id));
		if (!r.ok) {
			io.err(r.error.message);
			return 1;
		}
		io.out(`${id.padEnd(14)} ${r.value ? "key set" : "no key"}`);
	}
	return 0;
};

/** `mete key set|delete <provider id>` and `mete key list`; a key never comes from argv. */
export const keyCommand = async (
	secrets: SecretStore,
	io: Io,
	action: string | undefined,
	provider: string | undefined,
) => {
	if (action === "list") return listKeys(secrets, io);
	const valid = provider !== undefined && PROVIDER.test(provider);
	if (valid && action === "set") return setKey(secrets, io, provider);
	if (valid && action === "delete") return deleteKey(secrets, io, provider);
	io.err(
		"usage: mete key set|delete <nvidia|openrouter|opencode-zen|custom:<slug>>, mete key list",
	);
	return 1;
};

const setKey = async (secrets: SecretStore, io: Io, provider: string) => {
	const key = await io.readSecret(`${provider} API key: `);
	if (!key) {
		io.err("no key entered");
		return 1;
	}
	const r = await secrets.set(apiKeyName(provider), key);
	io.out(r.ok ? `${provider} key saved in the keychain` : r.error.message);
	return r.ok ? 0 : 1;
};

const deleteKey = async (secrets: SecretStore, io: Io, provider: string) => {
	const r = await secrets.delete(apiKeyName(provider));
	if (!r.ok) io.out(r.error.message);
	else io.out(r.value ? `${provider} key deleted` : `${provider} had no key`);
	return r.ok ? 0 : 1;
};
