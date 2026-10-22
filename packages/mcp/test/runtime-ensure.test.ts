import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ok,
	type PolicyCheckAdapter,
	type PolicyVerdict,
} from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRuntimeEnsure } from "../src/application/runtime-ensure.js";
import type { RuntimeSystem } from "../src/infrastructure/runtime-system.js";

const signal = new AbortController().signal;
const ctx = { signal };
const bytes = Buffer.from("archive");
const sha256 = createHash("sha256").update(bytes).digest("hex");

let dir = "";
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "mete-rt-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const setup = (
	opts: {
		verdict?: PolicyVerdict["verdict"];
		platform?: string;
		on?: Record<string, string>;
		nodeVersion?: string;
	} = {},
) => {
	const fetched: string[] = [];
	const checks: unknown[] = [];
	const policy: PolicyCheckAdapter = {
		check: (input) => {
			checks.push(input);
			const verdict = opts.verdict ?? "allow";
			return ok({ verdict, rule: `kit:${verdict}` });
		},
	};
	const system: RuntimeSystem = {
		which: (command) => opts.on?.[command],
		version: async () => opts.nodeVersion,
		extract: async (_archive, into) => {
			await writeFile(join(into, "tool.exe"), "bin");
			return ok(undefined);
		},
	};
	const ensure = createRuntimeEnsure({
		adapterId: "mcp-client",
		globalDir: dir,
		platform: opts.platform ?? "linux-x64",
		policy: () => policy,
		fetch: async (url) => {
			fetched.push(String(url));
			return new Response(bytes);
		},
		system,
	});
	return { ensure, fetched, checks };
};

describe("runtime.ensure@1", () => {
	it("uses a system Node.js of version 20 or newer without downloading", async () => {
		const { ensure, fetched } = setup({
			on: { node: "/sys" },
			nodeVersion: "v22.1.0",
		});
		expect(await ensure.run({ runtime: "node" }, ctx)).toEqual(
			ok({ binDir: "/sys" }),
		);
		expect(fetched).toEqual([]);
	});

	it("downloads the pinned Node.js for an older one, and refuses an archive whose hash differs", async () => {
		const { ensure, fetched, checks } = setup({
			on: { node: "/sys" },
			nodeVersion: "v18.0.0",
		});
		const r = await ensure.run({ runtime: "node" }, ctx);
		expect(r.ok === false && r.error.message).toContain("SHA-256");
		expect(fetched).toEqual([
			"https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.gz",
		]);
		expect(checks).toMatchObject([
			{ action: "runtime.install", capability: "runtime.ensure@1" },
		]);
		expect(readdirSync(dir)).toEqual([]);
	});

	it("asks before any download and uses an installed runtime without asking", async () => {
		const asked = setup({ verdict: "ask" });
		const r = await asked.ensure.run({ runtime: "python" }, ctx);
		expect(r.ok === false && r.error).toMatchObject({
			code: "approval_required",
			rule: "kit:ask",
		});
		expect(asked.fetched).toEqual([]);
		const uv = join(dir, "runtimes", "uv", "0.12.23");
		await mkdir(uv, { recursive: true });
		const denied = setup({ verdict: "deny" });
		expect(await denied.ensure.run({ runtime: "python" }, ctx)).toEqual(
			ok({ binDir: join(uv, "uv-x86_64-unknown-linux-gnu") }),
		);
		expect(denied.checks).toEqual([]);
	});

	it("extracts a binary archive once for parallel calls and saves a plain binary as one file", async () => {
		const { ensure, fetched } = setup();
		const zip = {
			runtime: "binary",
			url: "https://a.example/t.zip",
			sha256,
		} as const;
		const [a, b] = await Promise.all([
			ensure.run(zip, ctx),
			ensure.run(zip, ctx),
		]);
		const bin = join(dir, "runtimes", "bin", sha256);
		expect(a).toEqual(ok({ binDir: bin }));
		expect(b).toEqual(a);
		expect(fetched).toHaveLength(1);
		expect(readdirSync(bin)).toEqual(["tool.exe"]);
		await rm(bin, { recursive: true });
		const plain = { ...zip, url: "https://a.example/tool" };
		expect(await ensure.run(plain, ctx)).toEqual(ok({ binDir: bin }));
		expect(await readFile(join(bin, "tool"), "utf8")).toBe("archive");
		expect(readdirSync(join(dir, "runtimes", "bin"))).toEqual([sha256]);
	});

	it("names a platform with no pinned runtime and a missing container runtime", async () => {
		const mac = setup({ platform: "darwin-arm64" });
		const r = await mac.ensure.run({ runtime: "python" }, ctx);
		expect(r.ok === false && r.error).toEqual({
			code: "not_found",
			message: "no managed python runtime for darwin-arm64",
		});
		const none = await mac.ensure.run({ runtime: "container" }, ctx);
		expect(none.ok === false && none.error.code).toBe("not_found");
		const podman = setup({ on: { podman: "/p" } });
		expect(await podman.ensure.run({ runtime: "container" }, ctx)).toEqual(
			ok({ binDir: "/p" }),
		);
		expect(existsSync(join(dir, "runtimes"))).toBe(false);
	});
});
