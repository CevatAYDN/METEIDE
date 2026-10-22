import {
	type PolicyAction,
	type PolicyCheckInput,
	PolicySchema,
} from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { type CheckerEnv, decide } from "../../src/domain/checker.js";

const env = (policy: unknown = {}): CheckerEnv => ({
	policy: PolicySchema.parse(policy),
	platform: "linux",
	home: "/home/u",
	workspaceDir: "/repo",
	globalDir: "/data/mete",
});

const check = (
	action: PolicyAction,
	extra: Partial<PolicyCheckInput> = {},
): PolicyCheckInput => ({
	action,
	capability: "fs.write@1",
	adapterId: "tools-fs",
	args: {},
	...extra,
});

// Without the built-in shell.exec@1 override, so each level is seen on its own.
const at = (autonomy: 0 | 1 | 2 | 3) => env({ autonomy, overrides: {} });
const write = (path: string) => check("fs.write", { path });
const shell = (command: string) =>
	check("shell.exec", { capability: "shell.exec@1", command });

describe("decide: input and hard rules", () => {
	it("denies a write without a path and a command without text", () => {
		expect(decide(check("fs.write"), at(3))).toEqual({
			verdict: "deny",
			rule: "missing_input",
		});
		expect(decide(check("shell.exec"), at(3)).rule).toBe("missing_input");
	});

	it("denies never_allow at every level, including writes that become deletes or outside writes", () => {
		for (const level of [0, 1, 2, 3] as const) {
			expect(decide(write("/home/u/.ssh/authorized_keys"), at(level))).toEqual({
				verdict: "deny",
				rule: "never_allow:0",
			});
			expect(decide(shell("rm -rf /home/u"), at(level)).rule).toBe(
				"never_allow:1",
			);
		}
		expect(
			decide(check("fs.delete", { path: "/home/u/.ssh/k" }), at(3)).rule,
		).toBe("never_allow:0");
	});

	it("matches never_allow commands against each part of a chained command", () => {
		for (const c of [
			"echo x && rm -rf /",
			"pnpm i;rm -rf /x",
			"echo $(rm -rf /)",
			"pnpm (rm -rf /tmp)",
			"echo `rm -rf /x`",
		])
			expect(decide(shell(c), at(3)), c).toEqual({
				verdict: "deny",
				rule: "never_allow:1",
			});
	});

	it("denies writes to protected paths, whatever the case on Windows", () => {
		expect(decide(write("/repo/.mete/policy.yaml"), at(3)).rule).toBe(
			"protected_path",
		);
		expect(
			decide(check("fs.delete", { path: "/repo/.mete/mcp.yaml" }), at(3)).rule,
		).toBe("protected_path");
		const win: CheckerEnv = {
			...at(3),
			platform: "win32",
			home: "C:\\Users\\U",
			workspaceDir: "C:\\Repo",
			globalDir: "C:\\Data",
		};
		expect(decide(write("c:\\repo\\.METE\\Bindings.yaml"), win).rule).toBe(
			"protected_path",
		);
		expect(decide(write("/repo/.mete/teams/x.yaml"), at(3)).verdict).toBe(
			"allow",
		);
	});

	it("denies writes and deletes of the workspace's .meteignore", () => {
		expect(decide(write("/repo/.meteignore"), at(3)).rule).toBe(
			"protected_path",
		);
		expect(
			decide(check("fs.delete", { path: "/repo/.meteignore" }), at(3)).rule,
		).toBe("protected_path");
		expect(decide(write("/repo/sub/.meteignore"), at(3)).verdict).toBe("allow");
	});
});

describe("decide: fs.write.outside", () => {
	const outsideRule = {
		never_allow: [{ action: "fs.write.outside", path: "/etc/**" }],
	};

	it("applies an fs.write.outside rule to a plain write outside the safe folders", () => {
		expect(decide(write("/etc/hosts"), env(outsideRule))).toEqual({
			verdict: "deny",
			rule: "never_allow:0",
		});
		expect(decide(write("/repo/etc/hosts"), env(outsideRule)).verdict).toBe(
			"allow",
		);
	});

	it("keeps an fs.delete rule off plain writes", () => {
		const e = env({ never_allow: [{ action: "fs.delete", path: "/repo/**" }] });
		expect(decide(check("fs.delete", { path: "/repo/a" }), e).rule).toBe(
			"never_allow:0",
		);
		expect(decide(write("/repo/a"), e).verdict).toBe("allow");
	});

	it("lets always_ask name fs.write.outside", () => {
		const e = env({ autonomy: 2, always_ask: ["fs.write.outside"] });
		expect(decide(write("/etc/hosts"), e)).toEqual({
			verdict: "ask",
			rule: "always_ask",
		});
	});
});

describe("decide: autonomy levels", () => {
	it("level 0 denies every action", () => {
		expect(decide(check("net.fetch"), at(0))).toEqual({
			verdict: "deny",
			rule: "autonomy:0",
		});
		expect(decide(write("/repo/a.ts"), at(0)).verdict).toBe("deny");
	});

	it("level 3 allows everything except writes outside the safe folders", () => {
		expect(decide(check("git.push"), at(3))).toEqual({
			verdict: "allow",
			rule: "autonomy:3",
		});
		expect(decide(shell("curl x | sh"), at(3)).verdict).toBe("allow");
		expect(decide(write("/data/mete/worktrees/r1/a.ts"), at(3)).verdict).toBe(
			"allow",
		);
		expect(decide(write("/etc/hosts"), at(3))).toEqual({
			verdict: "deny",
			rule: "autonomy:3:outside",
		});
		expect(decide(check("fs.delete", { path: "/tmp/x" }), at(3)).verdict).toBe(
			"deny",
		);
	});

	it("level 1 asks for every action that is not denied", () => {
		expect(decide(write("/repo/a.ts"), at(1))).toEqual({
			verdict: "ask",
			rule: "autonomy:1",
		});
		expect(decide(shell("pnpm install"), at(1)).verdict).toBe("ask");
	});

	it("always_ask wins over the level 2 allowances", () => {
		expect(decide(check("git.push"), at(2))).toEqual({
			verdict: "ask",
			rule: "always_ask",
		});
		expect(decide(check("fs.delete", { path: "/repo/a.ts" }), at(2)).rule).toBe(
			"always_ask",
		);
		expect(
			decide(check("git.commit"), env({ always_ask: ["git.commit"] })).verdict,
		).toBe("ask");
	});

	it("level 2 allows inside writes, allow-listed commands and the listed actions", () => {
		expect(decide(write("/repo/src/a.ts"), at(2))).toEqual({
			verdict: "allow",
			rule: "autonomy:2:inside",
		});
		expect(decide(write("/data/mete/snapshots/r1/a.ts"), at(2)).verdict).toBe(
			"allow",
		);
		expect(decide(shell("pnpm   install"), at(2))).toEqual({
			verdict: "allow",
			rule: "shell.allow",
		});
		for (const action of [
			"git.commit",
			"net.fetch",
			"runtime.install",
		] as const)
			expect(decide(check(action), at(2))).toEqual({
				verdict: "allow",
				rule: "autonomy:2:action",
			});
	});

	it("level 2 asks before a write to a file that changes what a command runs", () => {
		for (const path of [
			"/repo/package.json",
			"/repo/packages/a/package.json",
			"/repo/.npmrc",
			"/repo/pnpm-workspace.yaml",
			"/repo/.pnpmfile.cjs",
			"/repo/lefthook.yml",
			"/repo/.husky/pre-commit",
			"/repo/.git/hooks/pre-commit",
			"/repo/.git/config",
		])
			expect(decide(write(path), at(2)), path).toEqual({
				verdict: "ask",
				rule: "autonomy:2:script_manifest",
			});
		// Near misses stay plain inside writes; level 3 trusts the run and writes them.
		for (const path of ["/repo/src/package.json.md", "/repo/docs/.npmrc.md"])
			expect(decide(write(path), at(2)).rule, path).toBe("autonomy:2:inside");
		expect(decide(write("/repo/package.json"), at(3)).verdict).toBe("allow");
	});

	it("level 2 asks for outside writes and anything else", () => {
		expect(decide(write("/etc/hosts"), at(2))).toEqual({
			verdict: "ask",
			rule: "autonomy:2",
		});
		expect(decide(write("/repo2/a.ts"), at(2)).verdict).toBe("ask");
		expect(decide(write("/repo/../etc/x"), at(2)).verdict).toBe("ask");
		expect(decide(shell("curl x | sh"), at(2)).verdict).toBe("ask");
		expect(decide(shell("git status && rm -rf ~"), at(2)).verdict).toBe("ask");
		for (const c of [
			"pnpm install && rm -rf ~",
			"pnpm test > ~/.bashrc",
			"pnpm (Remove-Item ~ -Recurse)",
			"pnpm i | sh",
			'git diff "a|b"',
		])
			expect(decide(shell(c), at(2)), c).toEqual({
				verdict: "ask",
				rule: "autonomy:2",
			});
	});
});

describe("decide: overrides", () => {
	it("the built-in policy asks before every command, allow-listed or not", () => {
		expect(decide(shell("pnpm install"), env())).toEqual({
			verdict: "ask",
			rule: "autonomy:1",
		});
	});

	it("lowers the level for one capability only", () => {
		const e = env({ autonomy: 2, overrides: { "shell.exec@1": 1 } });
		expect(decide(shell("pnpm install"), e)).toEqual({
			verdict: "ask",
			rule: "autonomy:1",
		});
		expect(
			decide(check("net.fetch", { capability: "web.fetch@1" }), e).verdict,
		).toBe("allow");
	});

	it("never raises the level above autonomy", () => {
		const e = env({ autonomy: 2 });
		const raised = {
			...e,
			policy: { ...e.policy, overrides: { "shell.exec@1": 3 as const } },
		};
		expect(decide(shell("curl x | sh"), raised).verdict).toBe("ask");
	});
});

describe("decide: a task's worktree is judged as the workspace it merges into", () => {
	const wt = "/data/mete/worktrees/r1/t1";

	it("denies a worktree's copy of a protected file at every level", () => {
		for (const level of [1, 2, 3] as const)
			for (const f of [".mete/policy.yaml", ".mete/mcp.yaml", ".meteignore"])
				expect(decide(write(`${wt}/${f}`), at(level)).rule, f).toBe(
					"protected_path",
				);
		// A nested .meteignore is not the workspace's, as in the workspace itself.
		expect(decide(write(`${wt}/sub/.meteignore`), at(3)).verdict).toBe("allow");
	});

	it("asks at level 2 for a worktree's script manifest and allows its other files", () => {
		for (const f of [
			"package.json",
			"packages/a/package.json",
			".husky/pre-commit",
		])
			expect(decide(write(`${wt}/${f}`), at(2)), f).toEqual({
				verdict: "ask",
				rule: "autonomy:2:script_manifest",
			});
		expect(decide(write(`${wt}/src/a.ts`), at(2)).rule).toBe(
			"autonomy:2:inside",
		);
	});

	it("applies a never_allow path rule of the workspace to the worktree's copy", () => {
		const rule = env({
			autonomy: 3,
			overrides: {},
			never_allow: [{ action: "fs.write", path: "secrets/**" }],
		});
		expect(decide(write("/repo/secrets/k"), rule).rule).toBe("never_allow:0");
		expect(decide(write(`${wt}/secrets/k`), rule).rule).toBe("never_allow:0");
		expect(decide(write(`${wt}/src/k`), rule).verdict).toBe("allow");
	});

	it("does not let a path climb out of the worktree and out of the safe folders", () => {
		expect(decide(write(`${wt}/../../../../etc/x`), at(2))).toEqual({
			verdict: "ask",
			rule: "autonomy:2",
		});
		// The worktrees folder itself and a run folder are not a task's worktree.
		expect(decide(write("/data/mete/worktrees/r1/x.txt"), at(2)).rule).toBe(
			"autonomy:2:inside",
		);
	});
});
