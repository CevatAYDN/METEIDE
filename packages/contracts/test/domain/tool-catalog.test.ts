import { describe, expect, it } from "vitest";
import {
	capabilityOf,
	isWrite,
	TOOL_CATALOG,
	toolName,
	toolSpec,
	VcsForModelSchema,
} from "../../src/domain/tool-catalog.js";
import { VcsGitInputSchema } from "../../src/domain/tools.js";

const call = (name: string, args: unknown = {}) => ({ id: "1", name, args });

describe("tool catalog", () => {
	it("names tools after their capability and maps the names back", () => {
		expect(toolName("fs.read@1")).toBe("fs_read");
		expect(toolName("shell.exec@1")).toBe("shell_exec");
		expect(capabilityOf("vcs_git")).toBe("vcs.git@2");
		expect(capabilityOf("web_fetch")).toBe("web.fetch@1");
		expect(capabilityOf("mcp_call")).toBeUndefined();
		for (const t of TOOL_CATALOG)
			expect(toolName(t.ref)).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
	});

	it("gives every tool a JSON Schema for an object", () => {
		for (const t of TOOL_CATALOG) {
			const spec = toolSpec(t);
			expect(spec.description.length).toBeGreaterThan(0);
			const p = spec.parameters as Record<string, unknown>;
			const union = p.oneOf ?? p.anyOf;
			expect(p.type === "object" || Array.isArray(union)).toBe(true);
		}
	});

	it("offers git status, diff and commit, never the core's checkpoints, worktrees or merges", () => {
		for (const input of [
			{ op: "status" },
			{ op: "diff" },
			{ op: "commit", message: "m" },
		])
			expect(VcsForModelSchema.safeParse(input).success).toBe(true);
		const runId = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";
		const taskId = "1b2c3d4e-5f60-4718-9a0b-c1d2e3f4a5b6";
		// Each one is valid for the core's schema, so only the model's schema can refuse it.
		for (const input of [
			{ op: "checkpoint.create", runId },
			{ op: "checkpoint.restore", ref: `refs/mete/checkpoints/${runId}/1` },
			{ op: "checkpoint.prune", runId },
			{ op: "worktree.create", runId, taskId },
			{ op: "worktree.remove", runId, taskId },
			{ op: "merge", runId, taskId, message: "m" },
		]) {
			expect(VcsGitInputSchema.safeParse(input).success).toBe(true);
			expect(VcsForModelSchema.safeParse(input).success).toBe(false);
		}
	});

	it("treats file writes, edits, commands and commits as writes", () => {
		for (const name of ["fs_write", "fs_edit", "shell_exec"])
			expect(isWrite(call(name))).toBe(true);
		for (const name of ["fs_read", "fs_list", "fs_glob", "fs_grep", "nope"])
			expect(isWrite(call(name))).toBe(false);
		expect(isWrite(call("vcs_git", { op: "commit", message: "m" }))).toBe(true);
		expect(isWrite(call("vcs_git", { op: "status" }))).toBe(false);
	});
});
