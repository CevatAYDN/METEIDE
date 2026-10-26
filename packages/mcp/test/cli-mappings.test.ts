import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	err,
	ok,
	type ShellExecInput,
	type ToolAdapter,
	type ToolContext,
} from "@mete/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMcpClientModule } from "../src/module.js";
import { moduleContext } from "./helpers/context.js";

// ADR-120: a cli mapping renders one command line for shell.exec@1 from the registry.

const signal = new AbortController().signal;

const cli = (id: string, implements_: string) => `apiVersion: mete/v1
kind: AdapterMapping
metadata: { id: ${id}, version: 1.0.0 }
type: cli
implements:
${implements_}`;

const GAME = `  gameengine.build@1:
    command: npm
    args: [run, build]
    success: { exitCode: 0 }
    output: { log: "{{result.stdout}}" }
  gameengine.importAsset@1:
    command: engine
    args: [import, "{{input.file}}"]
    success: { exitCode: 0 }
    output: { log: "{{result.stdout}}" }
  gameengine.test@1:
    command: C:/Program Files/engine.exe
    success: { exitCode: 0 }
    output: { log: "{{result.stdout}}" }
  3d.export@1:
    command: blender
    args: ["{{input}}"]
    success: { exitCode: 0 }
    output: { file: "{{input.file}}" }
`;

const SHARED = `  gameengine.build@1:
    command: make
    success: { exitCode: 0 }
    output: { log: "{{result.stdout}}" }
`;

type Ran = { input: ShellExecInput; ctx: ToolContext };

describe("level 2 CLI mappings", () => {
	let builtIn = "";
	let workspace = "";
	let module: ReturnType<typeof createMcpClientModule>;
	let warnings: string[] = [];
	let shell: ToolAdapter<ShellExecInput, unknown>["run"];
	const ran: Ran[] = [];
	let found: (ref: string, id: string) => ToolAdapter<unknown, unknown>["run"];
	beforeAll(async () => {
		builtIn = await mkdtemp(join(tmpdir(), "mete-adapters-"));
		workspace = await mkdtemp(join(tmpdir(), "mete-workspace-"));
		const own = join(workspace, ".mete", "adapters");
		await mkdir(own, { recursive: true });
		await writeFile(join(builtIn, "shared.yaml"), cli("shared", SHARED));
		await writeFile(join(own, "game.yaml"), cli("game", GAME));
		await writeFile(join(own, "shared.yaml"), cli("shared", SHARED));
		module = createMcpClientModule({
			workspaceDir: workspace,
			adaptersDir: builtIn,
		});
		const c = moduleContext("allow");
		warnings = c.warnings;
		c.registry.provide("shell.exec@1", {
			id: "tools",
			trust: "core",
			features: [],
			impl: {
				run: (input: ShellExecInput, ctx: ToolContext) => shell(input, ctx),
			},
		});
		expect((await module.activate(c.ctx)).ok).toBe(true);
		found = (ref, id) => async (input, ctx) => {
			const r = c.registry.resolve<ToolAdapter<unknown, unknown>>(
				ref as "a.b@1",
			);
			const impl = r.ok ? r.value.find((a) => a.id === id)?.impl : undefined;
			return impl ? impl.run(input, ctx) : err({ code: "io", message: "none" });
		};
	});
	beforeEach(() => {
		ran.length = 0;
		shell = async (input, ctx) => {
			ran.push({ input, ctx });
			return ok({
				exitCode: 0,
				stdout: "built\n",
				stderr: "",
				os: "x",
				shell: "x",
				timedOut: false,
			});
		};
	});
	afterAll(async () => {
		await module.deactivate();
		await rm(builtIn, { recursive: true, force: true });
		await rm(workspace, { recursive: true, force: true });
	});

	it("runs the program with each argument quoted, in the task's folder, and maps its output", async () => {
		const ctx = { signal, cwd: "/wt/t1", runId: "r1" };
		const r = await found("gameengine.build@1", "game")({}, ctx);
		expect(r).toEqual({ ok: true, value: { log: "built\n" } });
		expect(ran).toEqual([{ input: { command: 'npm "run" "build"' }, ctx }]);
	});

	it("fails with the command's output when the exit code is not the expected one", async () => {
		shell = async () =>
			ok({
				exitCode: 2,
				stdout: "",
				stderr: "missing script",
				os: "x",
				shell: "x",
				timedOut: false,
			});
		const r = await found("gameengine.build@1", "game")({}, { signal });
		expect(r.ok === false && r.error).toEqual({
			code: "io",
			message:
				'mapping game for gameengine.build@1: npm "run" "build" exited with 2\nmissing script',
		});
	});

	it("passes the policy's ask and deny through unchanged, so the run can pause", async () => {
		const ask = {
			code: "approval_required",
			rule: "kit:ask",
			message: "asks",
		} as const;
		shell = async () => err(ask);
		expect(await found("gameengine.build@1", "game")({}, { signal })).toEqual({
			ok: false,
			error: ask,
		});
	});

	it("refuses an argument that a shell could read as more than one word", async () => {
		for (const file of ['a"b', "$HOME", "a`b", "a\nb", "a\u201Db", "dir\\"]) {
			const r = await found("gameengine.importAsset@1", "game")(
				{ file },
				{ signal },
			);
			expect(r.ok === false && r.error.message, file).toContain(
				JSON.stringify(file),
			);
		}
		expect(ran).toEqual([]);
	});

	it("refuses a program with a space and an argument that is not text", async () => {
		const program = await found("gameengine.test@1", "game")({}, { signal });
		expect(program.ok === false && program.error.message).toContain(
			'"C:/Program Files/engine.exe"',
		);
		const object = await found("3d.export@1", "game")(
			{ file: "a.glb", format: "fbx" },
			{ signal },
		);
		expect(object.ok === false && object.error.message).toContain(
			"argument 1 is not text",
		);
		expect(ran).toEqual([]);
	});

	it("skips a workspace mapping whose id a built-in one already has", () => {
		expect(warnings).toEqual(["mapping id shared is used by another file"]);
	});
});
