import type {
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

// Prints the run's events until it ends or pauses for anything but quota, which waits here.
// Without a run id it follows the first run created after it subscribed: a CLI starts one run.
const follow = (events: EventBus, io: Io, resume?: string) => {
	let target = resume;
	let pausedFor: string | undefined;
	const ended = new Promise<Ended>((resolve) => {
		const show = (e: MeteEvent) => {
			if (target === undefined && e.type === "run.created") target = e.runId;
			if (e.runId === undefined || e.runId !== target) return;
			const line = eventLine(e);
			if (line) io.out(line);
			if (e.type === "run.paused") pausedFor = e.payload.reason;
			const end = endOf(e);
			if (end) done(end);
		};
		const subs = (["run.*", "agent.*", "checkpoint.*"] as const).map((p) =>
			events.subscribe(p, show),
		);
		const done = (status: Ended) => {
			for (const s of subs) s.dispose();
			resolve(status);
		};
	});
	return { ended, runId: () => target, pausedFor: () => pausedFor };
};

const endOf = (e: MeteEvent): Ended | undefined => {
	if (e.type === "run.completed") return "completed";
	if (e.type === "run.failed") return "failed";
	if (e.type === "run.cancelled") return "cancelled";
	if (e.type === "run.paused" && e.payload.reason !== "quota") return "paused";
	return undefined;
};

// Approvals come in Phase 2; until then the user decides through the policy (ARCHITECTURE.md, CLI).
const APPROVAL_HINT = [
	"The agent needs an approval, and approvals come in Phase 2.",
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

/** `mete run "<goal>"` or `mete run --resume <run id>`. */
export const runCommand = (
	app: App,
	io: Io,
	what: { goal: string } | { resume: string },
) =>
	withEngine(app, io, async (engine) => {
		const resume = "resume" in what ? what.resume : undefined;
		const run = follow(app.events, io, resume);
		const r = resume
			? await engine.resume(resume)
			: await engine.start({ goal: "goal" in what ? what.goal : "" });
		if (!r.ok) {
			io.err(r.error.message);
			return 1;
		}
		const stopWatching = io.onInterrupt(() => {
			const id = run.runId();
			if (id) void engine.cancel(id);
		});
		const status = await run.ended;
		stopWatching();
		if (status === "paused" && run.pausedFor() === "approval")
			for (const line of APPROVAL_HINT) io.err(line);
		if (status === "paused")
			io.err(`Resume it with: mete run --resume ${run.runId()}`);
		return exitCode(status);
	});

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
		for (const run of listed.value) {
			if (run.status !== "paused") {
				if (target === "all") continue;
				io.err(
					`${run.id} is ${run.status}; a running run stops with Ctrl+C in its mete run`,
				);
				code = 1;
				continue;
			}
			const r = await engine.cancel(run.id);
			io.out(r.ok ? `${run.id} cancelled` : r.error.message);
			if (!r.ok) code = 1;
		}
		return code;
	});

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
	if (
		(action !== "set" && action !== "delete") ||
		!provider ||
		!PROVIDER.test(provider)
	) {
		io.err(
			"usage: mete key set|delete <nvidia|openrouter|opencode-zen|custom:<slug>>, mete key list",
		);
		return 1;
	}
	const name = apiKeyName(provider);
	if (action === "delete") {
		const r = await secrets.delete(name);
		io.out(
			r.ok
				? r.value
					? `${provider} key deleted`
					: `${provider} had no key`
				: r.error.message,
		);
		return r.ok ? 0 : 1;
	}
	const key = await io.readSecret(`${provider} API key: `);
	if (!key) {
		io.err("no key entered");
		return 1;
	}
	const r = await secrets.set(name, key);
	io.out(r.ok ? `${provider} key saved in the keychain` : r.error.message);
	return r.ok ? 0 : 1;
};
