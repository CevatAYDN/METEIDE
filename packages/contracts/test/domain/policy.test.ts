import { describe, expect, it } from "vitest";
import {
	PolicyCheckInputSchema,
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
			],
			shell: {
				allow: ["pnpm *", "npm test", "npm run *", "git status", "git diff *"],
			},
			budget: { cloud_requests_per_run: 150, max_hours: 6 },
			approval_timeout_hours: 24,
		});
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
