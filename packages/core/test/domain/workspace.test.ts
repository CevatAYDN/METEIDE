import { describe, expect, it } from "vitest";
import {
	WORKSPACE_MAX_CHARS,
	WORKSPACE_MAX_NAMES,
} from "../../src/defaults.js";
import { workspaceBlock } from "../../src/domain/workspace.js";

describe("the workspace block (ADR-126)", () => {
	it("is left out when nothing was read", () => {
		expect(workspaceBlock({ names: [] })).toBeUndefined();
	});

	it("names at most its share of the top folder and cuts the file, never the label", () => {
		const names = Array.from({ length: 150 }, (_, i) => `file-${i}.ts`);
		const block = workspaceBlock({
			names,
			file: { path: "README.md", text: "x".repeat(10_000) },
		});
		expect(block?.length).toBeLessThanOrEqual(WORKSPACE_MAX_CHARS);
		expect(block).toContain(`file-${WORKSPACE_MAX_NAMES - 1}.ts and 50 more`);
		expect(block?.startsWith("<workspace> ")).toBe(true);
		expect(block?.endsWith("…\n</workspace>")).toBe(true);
	});
});
