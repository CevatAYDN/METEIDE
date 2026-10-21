import { describe, expect, it } from "vitest";
import { openingMessages } from "../../src/domain/prompt.js";
import {
	capabilityOf,
	isWrite,
	toolName,
	toolSpec,
	VcsForModelSchema,
	WORKSPACE_TOOLS,
} from "../../src/domain/tools.js";

const call = (name: string, args: unknown = {}) => ({ id: "1", name, args });

describe("workspace tools", () => {
	it("names tools after their capability and maps the names back", () => {
		expect(toolName("fs.read@1")).toBe("fs_read");
		expect(toolName("shell.exec@1")).toBe("shell_exec");
		expect(capabilityOf("vcs_git")).toBe("vcs.git@1");
		expect(capabilityOf("web_fetch")).toBe("web.fetch@1");
		expect(capabilityOf("mcp_call")).toBeUndefined();
		for (const t of WORKSPACE_TOOLS)
			expect(toolName(t.ref)).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
	});

	it("gives every tool a JSON Schema for an object", () => {
		for (const t of WORKSPACE_TOOLS) {
			const spec = toolSpec(t);
			expect(spec.description.length).toBeGreaterThan(0);
			const p = spec.parameters as Record<string, unknown>;
			const union = p.oneOf ?? p.anyOf;
			expect(p.type === "object" || Array.isArray(union)).toBe(true);
		}
	});

	it("offers git status, diff and commit, never checkpoints", () => {
		for (const input of [
			{ op: "status" },
			{ op: "diff" },
			{ op: "commit", message: "m" },
		])
			expect(VcsForModelSchema.safeParse(input).success).toBe(true);
		for (const op of [
			"checkpoint.create",
			"checkpoint.restore",
			"checkpoint.prune",
		])
			expect(
				VcsForModelSchema.safeParse({ op, runId: "r", ref: "x" }).success,
			).toBe(false);
	});

	it("treats file writes, edits, commands and commits as writes", () => {
		for (const name of ["fs_write", "fs_edit", "shell_exec"])
			expect(isWrite(call(name))).toBe(true);
		for (const name of ["fs_read", "fs_list", "fs_glob", "fs_grep", "nope"])
			expect(isWrite(call(name))).toBe(false);
		expect(isWrite(call("vcs_git", { op: "commit", message: "m" }))).toBe(true);
		expect(isWrite(call("vcs_git", { op: "status" }))).toBe(false);
	});

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
