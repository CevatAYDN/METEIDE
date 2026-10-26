import { describe, expect, it } from "vitest";
import {
	PolicyCheckInputSchema,
	PolicyGrantInputSchema,
	PolicySchema,
} from "../../src/domain/policy.js";

describe("PolicySchema", () => {
	it("fills every key from the SECURITY.md example when the file is empty", () => {
		expect(PolicySchema.parse({})).toEqual({
			autonomy: 2,
			overrides: { "shell.exec@1": 1 },
			always_ask: [
				"fs.delete",
				"git.push",
				"git.merge",
				"plugin.install",
				"mcp.install",
				"mcp.sampling",
				"release.publish",
				"vault.write.personal",
			],
			never_allow: [
				{ action: "fs.write", path: "~/.ssh/**" },
				{ action: "shell.exec", command: "rm -rf /*" },
				{ action: "shell.exec", command: "*taskkill*" },
				{ action: "shell.exec", command: "*tskill*" },
				{ action: "shell.exec", command: "*Stop-Process*" },
				{ action: "shell.exec", command: "spps *" },
				{ action: "shell.exec", command: "kill *" },
				{ action: "shell.exec", command: "pkill *" },
				{ action: "shell.exec", command: "killall *" },
				{ action: "shell.exec", command: "*.Kill*" },
			],
			shell: {
				allow: ["pnpm *", "npm test", "npm run *", "git status", "git diff *"],
				always: [],
			},
			budget: { cloud_requests_per_run: 150, max_hours: 6 },
			approval_timeout_hours: 24,
		});
	});

	it("keeps the exact commands the user allowed for good beside the allow list (ADR-121)", () => {
		const p = PolicySchema.parse({ shell: { always: ["npm install"] } });
		expect(p.shell.always).toEqual(["npm install"]);
		expect(p.shell.allow).toContain("pnpm *");
		expect(PolicySchema.safeParse({ shell: { always: [""] } }).success).toBe(
			false,
		);
	});

	it("treats a missing file like an empty one", () => {
		expect(PolicySchema.parse(undefined).autonomy).toBe(2);
	});

	it("accepts an override at or below the autonomy level", () => {
		const r = PolicySchema.safeParse({ overrides: { "shell.exec@1": 1 } });
		expect(r.success && r.data.overrides).toEqual({ "shell.exec@1": 1 });
	});

	it("fills the built-in override after the check, so autonomy 0 alone is valid", () => {
		const r = PolicySchema.safeParse({ autonomy: 0 });
		expect(r.success && r.data.overrides).toEqual({ "shell.exec@1": 1 });
		expect(PolicySchema.parse({ overrides: {} }).overrides).toEqual({});
	});

	it("rejects an override above the autonomy level", () => {
		const r = PolicySchema.safeParse({
			autonomy: 1,
			overrides: { "shell.exec@1": 2 },
		});
		expect(
			PolicySchema.safeParse({ autonomy: 0, overrides: { "shell.exec@1": 1 } })
				.success,
		).toBe(false);
		expect(
			r.success ? [] : r.error.issues.map((i) => i.path.join(".")),
		).toEqual(["overrides.shell.exec@1"]);
	});

	it("rejects unknown keys, actions and levels", () => {
		expect(PolicySchema.safeParse({ autonomy: 4 }).success).toBe(false);
		expect(PolicySchema.safeParse({ always_ask: ["fs.read"] }).success).toBe(
			false,
		);
		expect(PolicySchema.safeParse({ autonomi: 2 }).success).toBe(false);
		expect(
			PolicySchema.safeParse({
				never_allow: [{ action: "shell.exec", path: "/x" }],
			}).success,
		).toBe(false);
	});
});

describe("PolicyCheckInputSchema", () => {
	it("accepts a minimal check and rejects an unknown action", () => {
		const base = { capability: "fs.write@1", adapterId: "tools-fs", args: {} };
		expect(
			PolicyCheckInputSchema.safeParse({ ...base, action: "fs.write" }).success,
		).toBe(true);
		expect(
			PolicyCheckInputSchema.safeParse({ ...base, action: "fs.read" }).success,
		).toBe(false);
	});
});

describe("PolicyGrantInputSchema", () => {
	const ask = {
		action: "shell.exec",
		capability: "shell.exec@1",
		adapterId: "tools-shell",
		command: "npm install",
	};
	const runId = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";

	it("grants an ask once or for the run, with a command, a path or neither", () => {
		for (const scope of ["once", "run"])
			expect(PolicyGrantInputSchema.parse({ runId, scope, ask })).toEqual({
				runId,
				scope,
				ask,
			});
		const { command: _, ...bare } = ask;
		const outside = {
			action: "fs.write.outside",
			capability: "fs.write@1",
			adapterId: "tools-fs",
			path: "C:/elsewhere/a.txt",
		};
		for (const other of [bare, outside])
			expect(
				PolicyGrantInputSchema.safeParse({ runId, scope: "run", ask: other })
					.success,
			).toBe(true);
	});

	it("rejects always, an unknown action, a missing adapter and a run that is no id", () => {
		const { adapterId: _, ...noAdapter } = ask;
		for (const bad of [
			{ runId, scope: "always", ask },
			{ runId, scope: "once", ask: { ...ask, action: "fs.read" } },
			{ runId, scope: "once", ask: noAdapter },
			{ runId: "r1", scope: "once", ask },
		])
			expect(PolicyGrantInputSchema.safeParse(bad).success).toBe(false);
	});
});
