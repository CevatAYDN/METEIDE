import { describe, expect, it } from "vitest";
import { openingMessages } from "../../src/domain/prompt.js";

describe("opening messages", () => {
	it("tells the model the OS and shell and gives the goal as the user message", () => {
		const [system, user] = openingMessages("fix it", {
			os: "Windows_NT 10",
			shell: "Windows PowerShell",
		});
		expect(system?.content).toContain(
			"Operating system: Windows_NT 10. Shell: Windows PowerShell.",
		);
		expect(user).toEqual({ role: "user", content: "fix it" });
	});
});
