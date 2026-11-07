import { describe, expect, it } from "vitest";
import {
	ToolIsolationInputSchema,
	ToolIsolationSchema,
} from "../../src/domain/tool-isolation.js";

describe("tool.isolation@1", () => {
	it("identifies the exact adapter, capability, input and optional working root", () => {
		const input = {
			capability: "fs.write@1",
			adapterId: "fixture",
			input: { path: "a.txt", content: "a" },
			cwd: "/trees/a",
		};
		expect(ToolIsolationInputSchema.parse(input)).toEqual(input);
		const { cwd: _, ...workspace } = input;
		expect(ToolIsolationInputSchema.parse(workspace)).toEqual(workspace);
	});

	it("rejects malformed or extra descriptor input", () => {
		const input = { capability: "fs.write@1", adapterId: "fixture", input: {} };
		for (const change of [
			{ capability: "fs.write" },
			{ adapterId: "" },
			{ cwd: "" },
			{ trust: "core" },
		])
			expect(
				ToolIsolationInputSchema.safeParse({ ...input, ...change }).success,
			).toBe(false);
	});

	it("requires an explicit canonical root only for worktree scope", () => {
		expect(ToolIsolationSchema.parse({ scope: "workspace" })).toEqual({
			scope: "workspace",
		});
		expect(
			ToolIsolationSchema.parse({ scope: "worktree", root: "/trees/a" }),
		).toEqual({ scope: "worktree", root: "/trees/a" });
		for (const value of [
			{ scope: "worktree" },
			{ scope: "worktree", root: "" },
			{ scope: "workspace", root: "/trees/a" },
			{ scope: "unknown" },
			{ scope: "worktree", root: "/trees/a", safe: true },
		])
			expect(ToolIsolationSchema.safeParse(value).success).toBe(false);
	});
});
