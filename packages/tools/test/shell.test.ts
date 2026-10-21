import { join } from "node:path";
import type { ShellConfig, ShellExecOutput, ToolError } from "@mete/contracts";
import { ok, type Result } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	type ShellDeps,
	shellCommand,
	shellTool,
} from "../src/application/shell.js";
import { createToolsShellModule } from "../src/module.js";
import { toolContext } from "./helpers/context.js";
import { tempWorkspace } from "./infrastructure/workspace.js";

let ws: Awaited<ReturnType<typeof tempWorkspace>> | undefined;
afterEach(async () => {
	await ws?.close();
	ws = undefined;
});

const WINDOWS = process.platform === "win32";
const node = (script: string) => `node -e "${script}"`;

const setup = async (shell: ShellConfig = { windows: "powershell" }) => {
	const w = await tempWorkspace();
	ws = w;
	const deps: ShellDeps = {
		adapterId: "tools-shell",
		workspaceDir: w.workspaceDir,
		worktreesDir: join(w.globalDir, "worktrees"),
		policy: () => ({ check: () => ok({ verdict: "allow", rule: "test" }) }),
		shell,
	};
	return { deps, w };
};

const run = (
	deps: ShellDeps,
	command: string,
	signal = new AbortController().signal,
) => shellTool(deps, { command }, { signal });

const value = (r: Result<ShellExecOutput, ToolError>) => {
	if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
	return r.value;
};

describe("shellCommand", () => {
	it("uses /bin/sh off Windows, PowerShell or Git Bash on Windows", () => {
		expect(shellCommand({ windows: "powershell" }, "ls", "linux")).toEqual({
			file: "/bin/sh",
			args: ["-c", "ls"],
			name: "sh",
		});
		const bash = shellCommand(
			{ windows: "git-bash", gitBashPath: "C:/bash.exe" },
			"ls",
			"win32",
		);
		expect(bash).toEqual({
			file: "C:/bash.exe",
			args: ["-c", "ls"],
			name: "Git Bash",
		});
		const ps = shellCommand({ windows: "powershell" }, "ls", "win32");
		expect(ps.file.toLowerCase()).toMatch(/powershell\.exe$/);
		expect(ps.args.at(-1)).toMatch(/UTF8[\s\S]*\nls\n[\s\S]*exit/);
	});

	it("falls back to C:\\Windows when SystemRoot is unset", () => {
		const root = process.env.SystemRoot;
		delete process.env.SystemRoot;
		try {
			const ps = shellCommand({ windows: "powershell" }, "ls", "win32");
			expect(ps.file.startsWith(join("C:\\Windows", "System32"))).toBe(true);
		} finally {
			if (root !== undefined) process.env.SystemRoot = root;
		}
	});
});

describe("shellTool", () => {
	it("passes non-ASCII output through unchanged", async () => {
		const { deps } = await setup();
		const out = value(await run(deps, node("process.stdout.write('ağaç ü')")));
		expect(out.stdout).toBe("ağaç ü");
	});

	it.runIf(WINDOWS)(
		"reports cmdlet output in UTF-8 and a failed cmdlet as 1",
		async () => {
			const { deps } = await setup();
			expect(value(await run(deps, "Write-Output 'çğış'")).stdout).toBe(
				"çğış\r\n",
			);
			expect(value(await run(deps, "Get-Item nope-xyz")).exitCode).toBe(1);
			const last = value(
				await run(deps, `${node("process.exit(3)")}; Write-Output hi`),
			);
			expect(last.exitCode).toBe(0);
		},
	);

	it("kills the command and fails with io when the run is cancelled", async () => {
		const { deps } = await setup();
		const c = new AbortController();
		const started = run(deps, node("setInterval(()=>{},1000)"), c.signal);
		setTimeout(() => c.abort(), 500);
		const r = await started;
		expect(r.ok ? undefined : r.error).toMatchObject({
			code: "io",
			message: "cancelled",
		});
	}, 15_000);

	it.runIf(WINDOWS)(
		"fails with io when the chosen Git Bash is missing",
		async () => {
			const { deps } = await setup({
				windows: "git-bash",
				gitBashPath: "C:/no/bash.exe",
			});
			const r = await run(deps, "ls");
			expect(r.ok ? undefined : r.error.code).toBe("io");
		},
	);

	it("refuses env keys that change which program runs, before asking policy", async () => {
		const { deps } = await setup();
		let asked = 0;
		const counting: ShellDeps = {
			...deps,
			policy: () => ({
				check: () => {
					asked++;
					return ok({ verdict: "allow", rule: "test" });
				},
			}),
		};
		for (const env of [{ PATH: "." }, { NODE_OPTIONS: "--require ./x.js" }]) {
			const r = await shellTool(
				counting,
				{ command: "node -v", env },
				{ signal: new AbortController().signal },
			);
			expect(r.ok ? undefined : r.error.code).toBe("bad_input");
		}
		expect(asked).toBe(0);
	});

	it("answers bad_input for a NUL byte, which the process API refuses", async () => {
		const { deps } = await setup();
		const signal = new AbortController().signal;
		for (const input of [
			{ command: "node -v\u0000" },
			{ command: "node -v", env: { CI: "1\u0000" } },
		]) {
			const r = await shellTool(deps, input, { signal });
			expect(r.ok ? undefined : r.error.code).toBe("bad_input");
		}
	});

	it("refuses a file or a missing folder as cwd", async () => {
		const { deps, w } = await setup();
		await w.put("a.txt", "a");
		const at = (cwd: string) =>
			shellTool(
				deps,
				{ command: "ls", cwd },
				{ signal: new AbortController().signal },
			);
		const codes = [await at("a.txt"), await at("nope")].map((r) =>
			r.ok ? "ok" : r.error.code,
		);
		expect(codes).toEqual(["bad_input", "not_found"]);
	});
});

describe("createToolsShellModule", () => {
	it("fails to activate on a bad shell section", async () => {
		const w = await tempWorkspace();
		ws = w;
		const { ctx } = toolContext("allow", { shell: { windows: "git-bash" } });
		const r = await createToolsShellModule(w).activate(ctx);
		expect(r.ok ? undefined : r.error).toMatchObject({
			code: "activation_failed",
			moduleId: "tools-shell",
		});
	});
});
