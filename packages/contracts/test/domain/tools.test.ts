import { describe, expect, it } from "vitest";
import {
	FsEditInputSchema,
	FsReadInputSchema,
	FsWriteInputSchema,
	ShellConfigSchema,
	ShellExecInputSchema,
	VcsGitInputSchema,
	WorktreeConfigSchema,
} from "../../src/domain/tools.js";

describe("tool input schemas", () => {
	it("accepts a line range and rejects a reversed or zero one", () => {
		expect(
			FsReadInputSchema.safeParse({ path: "a", startLine: 2, endLine: 2 })
				.success,
		).toBe(true);
		for (const bad of [
			{ path: "a", startLine: 3, endLine: 2 },
			{ path: "a", startLine: 0 },
			{ path: "" },
			{ path: "a", extra: 1 },
		])
			expect(FsReadInputSchema.safeParse(bad).success).toBe(false);
	});

	it("takes content or a delete for fs.write, never both", () => {
		expect(FsWriteInputSchema.parse({ path: "a", content: "" })).toEqual({
			path: "a",
			content: "",
		});
		expect(FsWriteInputSchema.parse({ path: "a", delete: true })).toEqual({
			path: "a",
			delete: true,
		});
		for (const bad of [
			{ path: "a", delete: false },
			{ path: "a", content: "x", delete: true },
			{ path: "a" },
		])
			expect(FsWriteInputSchema.safeParse(bad).success).toBe(false);
	});

	it("needs a non-empty oldStr for fs.edit", () => {
		expect(
			FsEditInputSchema.safeParse({ path: "a", oldStr: "", newStr: "b" })
				.success,
		).toBe(false);
	});

	it("takes string env values and a positive whole timeout", () => {
		const ok = { command: "ls", timeoutSec: 5, env: { A: "1" } };
		expect(ShellExecInputSchema.parse(ok)).toEqual(ok);
		for (const bad of [
			{ command: "ls", timeoutSec: 0.5 },
			{ command: "ls", env: { A: 1 } },
			{ command: "" },
		])
			expect(ShellExecInputSchema.safeParse(bad).success).toBe(false);
	});
});

describe("ShellConfigSchema", () => {
	it("defaults to PowerShell and needs a path for Git Bash", () => {
		expect(ShellConfigSchema.parse(undefined)).toEqual({
			windows: "powershell",
		});
		expect(
			ShellConfigSchema.parse({ windows: "git-bash", gitBashPath: "C:/bash" }),
		).toEqual({ windows: "git-bash", gitBashPath: "C:/bash" });
		expect(ShellConfigSchema.safeParse({ windows: "git-bash" }).success).toBe(
			false,
		);
	});
});

describe("WorktreeConfigSchema", () => {
	it("defaults to empty object and accepts optional trimmed non-empty setup command", () => {
		expect(WorktreeConfigSchema.parse(undefined)).toEqual({});
		expect(WorktreeConfigSchema.parse({})).toEqual({});
		expect(WorktreeConfigSchema.parse({ setup: "pnpm install" })).toEqual({
			setup: "pnpm install",
		});
		expect(WorktreeConfigSchema.parse({ setup: "  pnpm test  " })).toEqual({
			setup: "pnpm test",
		});
	});

	it("rejects empty setup string and unknown keys", () => {
		expect(WorktreeConfigSchema.safeParse({ setup: "" }).success).toBe(false);
		expect(WorktreeConfigSchema.safeParse({ setup: "   " }).success).toBe(
			false,
		);
		expect(WorktreeConfigSchema.safeParse({ unknownKey: "val" }).success).toBe(
			false,
		);
	});
});

describe("VcsGitInputSchema", () => {
	const RUN = "7f3c2a1e-4b5d-4c6e-8f9a-0b1c2d3e4f5a";

	it("accepts the Phase 1 operations", () => {
		for (const good of [
			{ op: "status" },
			{ op: "diff", staged: true, path: "src" },
			{ op: "commit", message: "fix: x", paths: ["a.ts"] },
			{ op: "checkpoint.create", runId: RUN },
			{ op: "checkpoint.restore", ref: `refs/mete/checkpoints/${RUN}/2` },
			{ op: "checkpoint.prune", runId: RUN },
		])
			expect(VcsGitInputSchema.parse(good)).toEqual(good);
	});

	it("rejects merge, push, empty messages and other refs", () => {
		for (const bad of [
			{ op: "merge", branch: "x" },
			{ op: "push" },
			{ op: "commit", message: "  " },
			{ op: "commit", message: "m", paths: [] },
			{ op: "checkpoint.restore", ref: "refs/heads/main" },
			{ op: "checkpoint.restore", ref: `refs/mete/checkpoints/${RUN}/0` },
			{ op: "checkpoint.create", runId: "x" },
		])
			expect(VcsGitInputSchema.safeParse(bad).success).toBe(false);
	});
});
