import { describe, expect, it } from "vitest";
import {
	ApprovalInputSchema,
	RunStartSchema,
} from "../../src/domain/engine.js";
import { shellName } from "../../src/domain/tools.js";

describe("team.engine@2 input", () => {
	it("defaults the priority to 1 and keeps a null template", () => {
		expect(RunStartSchema.parse({ goal: "fix the bug" })).toEqual({
			goal: "fix the bug",
			priority: 1,
		});
		expect(
			RunStartSchema.parse({ goal: "g", templateId: null, priority: 0 }),
		).toEqual({ goal: "g", templateId: null, priority: 0 });
	});

	it("lets a run that continues a handoff leave out its goal", () => {
		expect(RunStartSchema.parse({ continue: true })).toEqual({
			continue: true,
			priority: 1,
		});
		expect(RunStartSchema.safeParse({}).success).toBe(false);
		expect(RunStartSchema.safeParse({ continue: false }).success).toBe(false);
	});

	it("refuses an empty goal, an unknown priority and extra keys", () => {
		for (const bad of [
			{ goal: "  " },
			{ goal: "g", priority: 3 },
			{ goal: "g", templateId: "" },
			{ goal: "g", extra: true },
		])
			expect(RunStartSchema.safeParse(bad).success).toBe(false);
	});

	it("takes an optional preferred model for single agent or per role (ADR-122)", () => {
		const single = {
			goal: "fix",
			prefer: { providerId: "nvidia", modelId: "deepseek-r1" },
		};
		expect(RunStartSchema.parse(single)).toEqual({ ...single, priority: 1 });
		const team = {
			goal: "fix",
			templateId: "dev",
			prefer: {
				coder: { providerId: "groq", modelId: "llama-3" },
				reviewer: { providerId: "openrouter", modelId: "claude-3.5-sonnet" },
			},
		};
		expect(RunStartSchema.parse(team)).toEqual({ ...team, priority: 1 });
		for (const bad of [
			{ goal: "g", prefer: "bad" },
			{ goal: "g", prefer: { coder: { providerId: "" } } },
			{ goal: "g", prefer: { providerId: "a" } },
		])
			expect(RunStartSchema.safeParse(bad).success).toBe(false);
	});
});

describe("team.engine@2 approval input", () => {
	it("takes a decision, an optional task and feedback", () => {
		expect(ApprovalInputSchema.parse({ decision: "approve" })).toEqual({
			decision: "approve",
		});
		const revise = { taskId: "report", decision: "revise", feedback: "cite" };
		expect(ApprovalInputSchema.parse(revise)).toEqual(revise);
	});

	it("refuses a revision without feedback, an unknown decision and extra keys", () => {
		for (const bad of [
			{ decision: "revise" },
			{ decision: "revise", feedback: " " },
			{ decision: "maybe" },
			{ decision: "approve", extra: 1 },
		])
			expect(ApprovalInputSchema.safeParse(bad).success).toBe(false);
	});
});

describe("shellName", () => {
	it("names the shell shell.exec@1 runs", () => {
		expect(shellName({ windows: "powershell" }, "linux")).toBe("sh");
		expect(shellName({ windows: "powershell" }, "win32")).toBe(
			"Windows PowerShell",
		);
		expect(
			shellName({ windows: "git-bash", gitBashPath: "C:/bash.exe" }, "win32"),
		).toBe("Git Bash");
	});
});
