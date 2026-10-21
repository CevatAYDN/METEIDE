import { describe, expect, it } from "vitest";
import { parseStatus } from "../../src/domain/git-status.js";

describe("parseStatus", () => {
	it("reads the branch, changes, renames and untracked files", () => {
		const out = [
			"## main...origin/main [ahead 1]",
			" M a.ts",
			"R  new.ts",
			"old.ts",
			"?? n e w.txt",
			"",
		].join("\0");
		expect(parseStatus(out)).toEqual({
			branch: "main",
			files: [
				{ path: "a.ts", index: " ", worktree: "M" },
				{ path: "new.ts", index: "R", worktree: " " },
				{ path: "n e w.txt", index: "?", worktree: "?" },
			],
		});
	});

	it("names the branch before the first commit and none when detached", () => {
		expect(parseStatus("## No commits yet on trunk\0").branch).toBe("trunk");
		expect(parseStatus("## HEAD (no branch)\0").branch).toBeNull();
	});
});
