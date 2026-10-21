import { describe, expect, it } from "vitest";
import { RunStartSchema } from "../../src/domain/engine.js";
import { shellName } from "../../src/domain/tools.js";

describe("team.engine@1 input", () => {
	it("defaults the priority to 1 and keeps a null template", () => {
		expect(RunStartSchema.parse({ goal: "fix the bug" })).toEqual({
			goal: "fix the bug",
			priority: 1,
		});
		expect(
			RunStartSchema.parse({ goal: "g", templateId: null, priority: 0 }),
		).toEqual({ goal: "g", templateId: null, priority: 0 });
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
