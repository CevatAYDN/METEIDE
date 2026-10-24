import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSnapshotStore } from "../../src/infrastructure/snapshot-store.js";
import { engineHarness, reply, type Tool } from "../helpers/engine.js";

// File snapshots in a folder that is not a git repository (ADR-080): no vcs.git@2, a real store in a
// temp folder, and fs tools that really write, so a copy shows the file as it was before.

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((r) => rm(r, { recursive: true, force: true })),
	);
});

const folders = async () => {
	const root = await mkdtemp(join(tmpdir(), "mete-snap-"));
	roots.push(root);
	const workspace = join(root, "work");
	const snapshots = join(root, "snapshots");
	await mkdir(workspace);
	await writeFile(join(workspace, "a.ts"), "foo\n");
	return { workspace, snapshots };
};

// fs tools that do what they say in the workspace.
const fsTools = (workspace: string) => {
	const edit: Tool = async (input) => {
		const { path } = input as { path: string };
		await writeFile(join(workspace, path), "bar\n");
		return ok({ replacements: 1 });
	};
	const write: Tool = async (input) => {
		const { path, content } = input as { path: string; content: string };
		await writeFile(join(workspace, path), content);
		return ok({ bytes: content.length });
	};
	return [
		["fs.edit@1", edit],
		["fs.write@1", write],
	] as const;
};

const run = async (calls: Parameters<typeof reply>[1]) => {
	const { workspace, snapshots } = await folders();
	const h = engineHarness({
		scripts: [reply("", calls), reply("Done.")],
		tools: fsTools(workspace),
		snapshots: createSnapshotStore(snapshots, workspace),
	});
	const r = await h.engine.start({ goal: "change files" });
	if (!r.ok) throw new Error(r.error.message);
	const runId = r.value.runId;
	await vi.waitFor(() => {
		const s = h.engine.status(runId);
		expect(s.ok && s.value[0]?.status).toBe("completed");
	});
	const manifest = async (n: number) =>
		JSON.parse(
			await readFile(
				join(snapshots, runId, String(n), "manifest.json"),
				"utf8",
			),
		);
	return { h, runId, workspace, snapshots, manifest };
};

describe("file snapshots without git", () => {
	it("opens one snapshot for a writing step and keeps each file as it was before its first write", async () => {
		const { h, runId, workspace, snapshots, manifest } = await run([
			{ name: "fs_edit", args: { path: "a.ts", oldStr: "foo", newStr: "bar" } },
			{ name: "fs_write", args: { path: "new.txt", content: "hi" } },
			{ name: "fs_edit", args: { path: "a.ts", oldStr: "bar", newStr: "baz" } },
		]);
		const created = h.events.filter((e) => e.type === "checkpoint.created");
		expect(created.map((e) => e.payload)).toEqual([
			{ kind: "snapshot", ref: `snapshots/${runId}/1` },
		]);
		expect(await manifest(1)).toEqual({
			step: expect.any(Number),
			entries: [
				{ path: "a.ts", existed: true },
				{ path: "new.txt", existed: false },
			],
		});
		expect(
			await readFile(join(snapshots, runId, "1", "files", "a.ts"), "utf8"),
		).toBe("foo\n");
		expect(await readFile(join(workspace, "a.ts"), "utf8")).toBe("bar\n");
	});

	it("does not copy a path outside the workspace", async () => {
		const { workspace, snapshots } = await folders();
		const store = createSnapshotStore(snapshots, workspace);
		const opened = await store.open("r1", 0);
		if (!opened.ok) throw new Error(opened.error.message);
		expect((await store.keep(opened.value, "../escape.txt")).ok).toBe(true);
		expect((await store.keep(opened.value, "a.ts")).ok).toBe(true);
		expect((await store.keep(opened.value, "./a.ts")).ok).toBe(true);
		const m = JSON.parse(
			await readFile(join(snapshots, "r1", "1", "manifest.json"), "utf8"),
		);
		expect(m.entries).toEqual([{ path: "a.ts", existed: true }]);
	});
});
