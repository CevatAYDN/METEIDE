import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	type ChatChunk,
	type ChatRequest,
	type ModuleManifest,
	ok,
	type ProviderAdapter,
	type SecretStore,
} from "@mete/contracts";
import type { MeteModule } from "@mete/kernel";
import type { Io } from "../src/application/commands.js";

// A temp git repository, an in-memory keychain and a scripted provider: no real provider is called.

const sh = promisify(execFile);

/** A git repository with one committed file, and a global data folder beside it. */
export const tempRepo = async (files: Record<string, string>) => {
	const root = await mkdtemp(join(tmpdir(), "mete-cli-"));
	const workspaceDir = join(root, "repo");
	await mkdir(workspaceDir);
	for (const [name, text] of Object.entries(files))
		await writeFile(join(workspaceDir, name), text);
	const env = {
		...process.env,
		HOME: root,
		USERPROFILE: root,
		GIT_CONFIG_NOSYSTEM: "1",
	};
	const git = (...args: string[]) =>
		sh("git", args, { cwd: workspaceDir, env }).then((r) => r.stdout.trim());
	await git("init", "-q", "-b", "main");
	await git("config", "core.autocrlf", "false");
	await git("add", "-A");
	await git(
		"-c",
		"user.name=t",
		"-c",
		"user.email=t@t",
		"commit",
		"-qm",
		"init",
	);
	return {
		workspaceDir,
		globalDir: join(root, "global"),
		git,
		close: () => rm(root, { recursive: true, force: true }),
	};
};

/** A keychain kept in a map. */
export const memorySecrets = (
	seed: Record<string, string> = {},
): SecretStore => {
	const m = new Map(Object.entries(seed));
	return {
		get: async (n) => ok(m.get(n)),
		set: async (n, v) => ok(void m.set(n, v)),
		delete: async (n) => ok(m.delete(n)),
	};
};

/** An Io that records lines and reads a fixed secret; with `answers` it also has a terminal that types them in turn. */
export const recordingIo = (secret = "", answers?: (string | undefined)[]) => {
	const out: string[] = [];
	const err: string[] = [];
	const prompts: string[] = [];
	let interrupt: (() => void) | undefined;
	const io: Io = {
		out: (l) => void out.push(l),
		err: (l) => void err.push(l),
		readSecret: async () => secret,
		...(answers
			? {
					readLine: async (prompt: string) => {
						prompts.push(prompt);
						return answers.shift();
					},
				}
			: {}),
		onInterrupt: (fn) => {
			interrupt = fn;
			return () => {
				interrupt = undefined;
			};
		},
	};
	return { io, out, err, prompts, interrupt: () => interrupt?.() };
};

const MANIFEST: ModuleManifest = {
	id: "provider-fake",
	version: "0.0.0",
	displayName: "Fake provider",
	class: "optional",
	trust: "first-party",
	provides: ["provider.chat@2"],
	requires: [],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: [],
};

/** How the scripted provider behaves: replies in order (the last repeats), no models, or a call that waits. */
export type Behaviour =
	| { script: ChatChunk[][]; seen?: ChatRequest[] }
	| { noModels: true }
	| { hang: true };

/** The provider's id (default fake), its request limit (default 20) and whether it is a daily one. */
export type FakeShape = {
	readonly id?: string;
	readonly limit?: number;
	readonly daily?: boolean;
};

/** A provider module behind the gateway that answers from a script; no network. */
export const scriptedProvider = (
	b: Behaviour,
	shape: FakeShape = {},
): MeteModule => {
	const id = shape.id ?? "fake";
	let calls = 0;
	const model = {
		id: "coder-1",
		providerId: id,
		family: "fake",
		contextWindow: 64_000,
		toolCalling: true,
		vision: false,
		free: true,
		deprecated: false,
	};
	const adapter: ProviderAdapter = {
		id,
		format: "openai-chat",
		listModels: async () => ok("noModels" in b ? [] : [model]),
		async *chat(req, signal) {
			if ("hang" in b) {
				await new Promise((r) => signal.addEventListener("abort", r));
				yield { type: "error", error: { code: "aborted", message: "aborted" } };
				return;
			}
			if ("script" in b) {
				b.seen?.push(req);
				yield* b.script[Math.min(calls++, b.script.length - 1)] ?? [];
			}
		},
		quotaUnits: () => [
			{
				providerId: id,
				unit: shape.daily ? "requests_per_day" : "requests_per_minute",
				scope: "account",
				limit: shape.limit ?? 20,
				reset: shape.daily ? "fixed_daily" : "sliding",
			},
		],
		observe: () => [],
		privacy: () => ({ trains: false, logs: false, publishes: false }),
	};
	return {
		manifest: { ...MANIFEST, id: `provider-${id}` },
		async activate(ctx) {
			ctx.disposables.add(
				ctx.capabilities.provide("provider.chat@2", {
					id,
					trust: "first-party",
					features: [],
					impl: adapter,
				}),
			);
			return ok(undefined);
		},
		async deactivate() {},
	};
};

export const silent = {
	error() {},
	warn() {},
	info() {},
	debug() {},
};
