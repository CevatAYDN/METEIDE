import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
	err,
	ok,
	type PolicyCheckAdapter,
	type Result,
	type RuntimeEnsureAdapter,
	RuntimeEnsureInputSchema,
	type RuntimeEnsureOutput,
	type ToolContext,
	type ToolError,
} from "@mete/contracts";
import { withLockRetry } from "@mete/kernel";
import { z } from "zod";
import {
	NODE_MIN_MAJOR,
	RUNTIME_INSTALL_TIMEOUT_MS,
	RUNTIME_PINS,
} from "../defaults.js";
import type { RuntimeSystem } from "../infrastructure/runtime-system.js";
import { permit } from "./permit.js";
import type { Confirm } from "./sampling.js";

// runtime.ensure@1 (docs/10, Managed runtimes): a runtime is found on the machine or downloaded
// on first need, hash-checked before it is opened, and renamed into place only when complete.

export type EnsureDeps = {
	readonly adapterId: string;
	readonly globalDir: string;
	/** `${process.platform}-${process.arch}`, the key of RUNTIME_PINS assets. */
	readonly platform: string;
	readonly policy: () => PolicyCheckAdapter | undefined;
	readonly fetch: typeof fetch;
	readonly system: RuntimeSystem;
	/** Asks the user when policy says `ask`; absent when the host has no terminal or dialog, and then the `ask` stays an error. */
	readonly confirm?: Confirm;
};

type Download = { readonly url: string; readonly sha256: string };
type Out = Promise<Result<RuntimeEnsureOutput, ToolError>>;

const io = (message: string) => err<ToolError>({ code: "io", message });
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
// An .mcpb bundle is a zip archive.
const ARCHIVE = /\.(zip|mcpb|tar\.gz|tgz)$/;

const download = async (
	deps: EnsureDeps,
	file: Download,
	signal: AbortSignal,
) => {
	try {
		const res = await deps.fetch(file.url, { signal });
		if (!res.ok) return io(`${file.url}: HTTP ${res.status}`);
		const bytes = Buffer.from(await res.arrayBuffer());
		const hash = createHash("sha256").update(bytes).digest("hex");
		if (hash !== file.sha256)
			return io(
				`${file.url}: SHA-256 ${hash} is not the pinned ${file.sha256}`,
			);
		return ok(bytes);
	} catch (e) {
		return io(`${file.url}: ${why(e)}`);
	}
};

// The partial folder becomes `dir` in one rename, so a crash never leaves a runtime that looks ready.
// Each call has its own partial folder, so two METE processes installing the same runtime never
// touch each other's files, and the one that renames second keeps the first one's runtime.
// shortcut: a crash leaves its partial folder beside `dir`; nothing sweeps it yet.
const placed = async (partial: string, dir: string) => {
	try {
		if (!existsSync(dir)) await withLockRetry(() => rename(partial, dir));
	} catch (e) {
		if (!existsSync(dir)) throw e;
	}
	await rm(partial, { recursive: true, force: true });
};

const unpack = async (
	deps: EnsureDeps,
	file: Download,
	bytes: Buffer,
	{ dir, signal }: { dir: string; signal: AbortSignal },
): Promise<Result<void, ToolError>> => {
	const partial = `${dir}.partial-${randomUUID()}`;
	const name = basename(new URL(file.url).pathname);
	await mkdir(partial, { recursive: true });
	if (!ARCHIVE.test(name))
		await writeFile(join(partial, name), bytes, { mode: 0o755 });
	else {
		const archive = `${partial}-${name}`;
		await writeFile(archive, bytes);
		const x = await deps.system.extract(archive, partial, signal);
		await rm(archive, { force: true });
		if (!x.ok) {
			await rm(partial, { recursive: true, force: true });
			return io(`${file.url}: ${x.error}`);
		}
	}
	await placed(partial, dir);
	return ok(undefined);
};

// A policy `ask` becomes one question to the user when the host can put one (autonomy 1, or `always_ask`).
const approved = async (
	deps: EnsureDeps,
	refused: ToolError,
	url: string,
	signal: AbortSignal,
): Promise<Result<void, ToolError>> => {
	if (refused.code !== "approval_required" || !deps.confirm)
		return err(refused);
	const yes = await deps.confirm(
		"runtime.ensure@1",
		`METE needs to download ${url} to run an MCP server. Allow it?`,
		signal,
	);
	return yes
		? ok(undefined)
		: err({
				...refused,
				code: "denied",
				message: `the user declined to download ${url}`,
			});
};

const install = async (
	deps: EnsureDeps,
	file: Download,
	dir: string,
	ctx: ToolContext,
): Promise<Result<void, ToolError>> => {
	if (existsSync(dir)) return ok(undefined);
	const check = {
		adapterId: deps.adapterId,
		action: "runtime.install",
		capability: "runtime.ensure@1",
		command: file.url,
		args: {},
	} as const;
	const allowed = permit(deps.policy(), check, ctx);
	if (!allowed.ok) {
		const granted = await approved(deps, allowed.error, file.url, ctx.signal);
		if (!granted.ok) return granted;
	}
	const signal = AbortSignal.any([
		ctx.signal,
		AbortSignal.timeout(RUNTIME_INSTALL_TIMEOUT_MS),
	]);
	const bytes = await download(deps, file, signal);
	if (!bytes.ok) return bytes;
	try {
		await mkdir(dirname(dir), { recursive: true });
		return await unpack(deps, file, bytes.value, { dir, signal });
	} catch (e) {
		return io(`${file.url}: ${why(e)}`);
	}
};

const managed = async (
	deps: EnsureDeps,
	runtime: "node" | "python",
	ctx: ToolContext,
): Out => {
	const pin = RUNTIME_PINS[runtime];
	const asset = Object.entries(pin.assets).find(([p]) => p === deps.platform);
	if (!asset)
		return err({
			code: "not_found",
			message: `no managed ${runtime} runtime for ${deps.platform}`,
		});
	const dir = join(deps.globalDir, "runtimes", pin.dir, pin.version);
	const done = await install(deps, asset[1], dir, ctx);
	return done.ok ? ok({ binDir: join(dir, asset[1].bin) }) : done;
};

const MAJOR = /^v(\d+)\./;

// A system Node.js new enough, with npx on the PATH too, is used as it is; otherwise the pinned one (docs/10).
const node = async (deps: EnsureDeps, ctx: ToolContext): Out => {
	const found = deps.system.which("npx") && deps.system.which("node");
	const v =
		found && (await deps.system.version(join(found, "node"), ctx.signal));
	const major = Number(MAJOR.exec(v ?? "")?.[1] ?? 0);
	if (found && major >= NODE_MIN_MAJOR) return ok({ binDir: found });
	return managed(deps, "node", ctx);
};

const container = (deps: EnsureDeps): Out => {
	const found = deps.system.which("docker") ?? deps.system.which("podman");
	return Promise.resolve(
		found
			? ok({ binDir: found })
			: err({ code: "not_found", message: "no docker or podman on PATH" }),
	);
};

const binary = async (
	deps: EnsureDeps,
	file: Download,
	ctx: ToolContext,
): Out => {
	const dir = join(deps.globalDir, "runtimes", "bin", file.sha256);
	const done = await install(deps, file, dir, ctx);
	return done.ok ? ok({ binDir: dir }) : done;
};

/** runtime.ensure@1; one install per runtime at a time in this process, a failed one is tried again. */
export const createRuntimeEnsure = (deps: EnsureDeps): RuntimeEnsureAdapter => {
	const running = new Map<string, Out>();
	const ensure = (
		input: z.output<typeof RuntimeEnsureInputSchema>,
		ctx: ToolContext,
	): Out => {
		if (input.runtime === "binary") return binary(deps, input, ctx);
		if (input.runtime === "container") return container(deps);
		return input.runtime === "node"
			? node(deps, ctx)
			: managed(deps, "python", ctx);
	};
	return {
		run: (raw, ctx) => {
			const input = RuntimeEnsureInputSchema.safeParse(raw);
			if (!input.success)
				return Promise.resolve(
					err({ code: "bad_input", message: z.prettifyError(input.error) }),
				);
			const key = JSON.stringify(input.data);
			const known = running.get(key);
			if (known) return known;
			const out = ensure(input.data, ctx).finally(() => running.delete(key));
			running.set(key, out);
			return out;
		},
	};
};
