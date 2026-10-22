import { createHash } from "node:crypto";
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
};

type Download = { readonly url: string; readonly sha256: string };
type Out = Promise<Result<RuntimeEnsureOutput, ToolError>>;

const io = (message: string) => err<ToolError>({ code: "io", message });
const why = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ARCHIVE = /\.(zip|tar\.gz|tgz)$/;

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
const unpack = async (
	deps: EnsureDeps,
	file: Download,
	bytes: Buffer,
	{ dir, signal }: { dir: string; signal: AbortSignal },
): Promise<Result<void, ToolError>> => {
	const partial = `${dir}.partial`;
	const name = basename(new URL(file.url).pathname);
	await rm(partial, { recursive: true, force: true });
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
	await withLockRetry(() => rename(partial, dir));
	return ok(undefined);
};

// shortcut: one process at a time; two METE processes installing the same runtime race on the rename, upgrade with a lock file.
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
	if (!allowed.ok) return allowed;
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

// A system Node.js new enough is used as it is; otherwise the pinned one (docs/10).
// shortcut: only `node` is checked, so a system Node.js without npm fails on npx; upgrade by also checking npx.
const node = async (deps: EnsureDeps, ctx: ToolContext): Out => {
	const found = deps.system.which("node");
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
