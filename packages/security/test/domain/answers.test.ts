import {
	type PolicyAsk,
	type PolicyCheckInput,
	PolicySchema,
} from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { type CheckerEnv, decide } from "../../src/domain/checker.js";
import { covers } from "../../src/domain/grants.js";

// What a human's answer to an ask changes (SECURITY.md, Answering an ask; ADR-121): the exact
// commands of shell.always, and which later checks a grant covers. Pure.

const env = (policy: unknown = {}, platform: NodeJS.Platform = "linux") =>
	({
		policy: PolicySchema.parse(policy),
		platform,
		home: "/home/u",
		workspaceDir: platform === "win32" ? "C:\\Repo" : "/repo",
		globalDir: "/data/mete",
	}) satisfies CheckerEnv;

const shell = (
	command: string,
	extra: Partial<PolicyCheckInput> = {},
): PolicyCheckInput => ({
	action: "shell.exec",
	capability: "shell.exec@1",
	adapterId: "tools-shell",
	args: { command },
	command,
	...extra,
});

const always = (commands: string[], rest: object = {}) =>
	env({ ...rest, shell: { always: commands } });

describe("decide: shell.always", () => {
	it("allows an exact command the user allowed for good, under the built-in level-1 override", () => {
		const e = always(["npm install"]);
		expect(decide(shell("  npm   install "), e)).toEqual({
			verdict: "allow",
			rule: "shell.always",
		});
		expect(decide(shell("npm install lodash"), e)).toEqual({
			verdict: "ask",
			rule: "autonomy:1",
		});
	});

	it("matches an entry with * as a pattern, only on a command with no shell operator (ADR-158)", () => {
		const e = always(["npm test *"]);
		expect(decide(shell("npm test src/a.test.ts"), e).rule).toBe(
			"shell.always",
		);
		expect(decide(shell("npm test a.ts && rm -rf ."), e).rule).toBe(
			"autonomy:1",
		);
		expect(decide(shell("npm install"), e).rule).toBe("autonomy:1");
	});

	it("asks again on a tainted step", () => {
		expect(
			decide(shell("npm install", { tainted: true }), always(["npm install"])),
		).toEqual({ verdict: "ask", rule: "autonomy:1" });
	});

	it("leaves never_allow, level 0 and always_ask in force", () => {
		expect(decide(shell("rm -rf /*"), always(["rm -rf /*"])).rule).toBe(
			"never_allow:1",
		);
		expect(
			decide(shell("npm install"), always(["npm install"], { autonomy: 0 })),
		).toEqual({ verdict: "deny", rule: "autonomy:0" });
		expect(
			decide(
				shell("npm install"),
				always(["npm install"], { always_ask: ["shell.exec"] }),
			).rule,
		).toBe("always_ask");
	});
});

const ask = (extra: Partial<PolicyAsk> = {}): PolicyAsk => ({
	action: "shell.exec",
	capability: "shell.exec@1",
	adapterId: "tools-shell",
	command: "npm install",
	...extra,
});

describe("covers", () => {
	it("covers the same command of the same action, capability and adapter, spaces collapsed", () => {
		expect(covers(ask(), shell(" npm  install"), env())).toBe(true);
		expect(covers(ask(), shell("npm install lodash"), env())).toBe(false);
		expect(
			covers(ask(), shell("npm install", { adapterId: "other" }), env()),
		).toBe(false);
		expect(
			covers(ask({ action: "git.push" }), shell("npm install"), env()),
		).toBe(false);
	});

	it("compares paths as the policy does: case ignored and separators unified on Windows", () => {
		const outside = (path: string): PolicyCheckInput => ({
			action: "fs.write.outside",
			capability: "fs.write@1",
			adapterId: "tools-fs",
			args: { path },
			path,
		});
		const byPath: PolicyAsk = {
			action: "fs.write.outside",
			capability: "fs.write@1",
			adapterId: "tools-fs",
			path: "C:\\Elsewhere\\A.txt",
		};
		expect(
			covers(byPath, outside("c:/elsewhere/a.txt"), env({}, "win32")),
		).toBe(true);
		expect(
			covers(byPath, outside("C:/elsewhere/b.txt"), env({}, "win32")),
		).toBe(false);
		const linux = { ...byPath, path: "/tmp/A.txt" };
		expect(covers(linux, outside("/tmp/a.txt"), env())).toBe(false);
	});

	it("covers every call of its action, capability and adapter when the ask named no command or path", () => {
		const call: PolicyCheckInput = {
			action: "mcp.call",
			capability: "mcp.tools@1",
			adapterId: "mcp-client",
			args: { server: "fs", tool: "read" },
		};
		const { command: _, ...bare } = ask({
			action: "mcp.call",
			capability: "mcp.tools@1",
			adapterId: "mcp-client",
		});
		expect(covers(bare, call, env())).toBe(true);
		expect(covers(bare, { ...call, adapterId: "other" }, env())).toBe(false);
	});

	it("never covers a check that names no command when the ask named one", () => {
		expect(
			covers(ask(), { ...shell("npm install"), command: undefined }, env()),
		).toBe(false);
	});
});
