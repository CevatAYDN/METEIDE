import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	Result,
	ToolAdapter,
	ToolContext,
	ToolError,
	VaultReadOutput,
	VaultWriteOutput,
} from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { day, NOW, setup } from "./setup.js";

// vault.read@1 and vault.write@1 (docs/11, Vaults; ADR-145) through the vault module.

const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({
	runId: RUN,
	signal: new AbortController().signal,
	...over,
});

const tools = async () => {
	const s = await setup();
	const impl = <O>(ref: "vault.read@1" | "vault.write@1") => {
		const r = s.registry.resolve<ToolAdapter<unknown, O>>(ref);
		if (!r.ok) throw new Error(`${ref} is not provided`);
		return r.value[0].impl;
	};
	const write = impl<VaultWriteOutput>("vault.write@1");
	const read = impl<VaultReadOutput>("vault.read@1");
	return { ...s, write, read };
};

const lesson = (title: string, extra: object = {}) => ({
	type: "lesson",
	title,
	body: "Write the collision test first.",
	...extra,
});

const code = (r: Result<unknown, ToolError>) => (r.ok ? "ok" : r.error.code);

describe("vault.write@1", () => {
	it("writes a lesson note with its frontmatter and reads it back", async () => {
		const t = await tools();
		const w = await t.write.run(
			lesson("Çarpışma testlerini erken yaz", { tags: ["testing"] }),
			ctx(),
		);
		const path = ".mete/knowledge/lessons/carpısma-testlerini-erken-yaz.md";
		expect(w).toEqual({ ok: true, value: { path, created: true } });
		const text = await t.file(path);
		expect(text).toBe(
			[
				"---",
				"type: lesson",
				"title: Çarpışma testlerini erken yaz",
				"created: 2026-10-28T12:00:00.000Z",
				"updated: 2026-10-28T12:00:00.000Z",
				`source: run/${RUN}`,
				"tags:",
				"  - testing",
				"private: false",
				"pinned: false",
				"---",
				"",
				"Write the collision test first.",
				"",
			].join("\n"),
		);
		expect(t.saved.map((e) => [e.runId, e.payload])).toEqual([
			[RUN, { path, noteType: "lesson" }],
		]);
		const r = await t.read.run(
			{ path: "lessons/carpısma-testlerini-erken-yaz.md" },
			ctx(),
		);
		expect(r.ok && r.value.content).toBe(text);
	});

	it("updates the note of the same title, keeping when and by whom it was created", async () => {
		const t = await tools();
		await t.write.run(lesson("Ship small", { tags: ["a"] }), ctx());
		const again = await t.write.run(
			lesson("Ship small!", { body: "Smaller.", tags: ["b"] }),
			ctx({ runId: OTHER }),
		);
		expect(again.ok && again.value.created).toBe(false);
		const text = await t.file(".mete/knowledge/lessons/ship-small.md");
		expect(text).toContain(`source: run/${RUN}\n`);
		expect(text).toContain("title: Ship small!\n");
		expect(text).toContain("tags:\n  - a\n  - b\n");
		expect(text.endsWith("---\n\nSmaller.\n")).toBe(true);
	});

	it("refuses a 4th new note in a run, and still updates one", async () => {
		const t = await tools();
		for (const title of ["One", "Two", "Three"])
			expect(code(await t.write.run(lesson(title), ctx()))).toBe("ok");
		const fourth = await t.write.run(lesson("Four"), ctx());
		expect(fourth.ok ? "" : fourth.error).toMatchObject({
			code: "bad_input",
			message: expect.stringContaining("3 new notes"),
		});
		expect(code(await t.write.run(lesson("Two"), ctx()))).toBe("ok");
		expect(code(await t.write.run(lesson("Four"), ctx({ runId: OTHER })))).toBe(
			"ok",
		);
	});

	it("writes to the workspace vault when the call comes from a task's worktree", async () => {
		const t = await tools();
		const worktree = join(t.root, "worktree");
		await t.write.run(lesson("Merge early"), ctx({ cwd: worktree }));
		expect(await t.file(".mete/knowledge/lessons/merge-early.md")).toContain(
			"title: Merge early",
		);
	});

	it("appends a journal note to today's note under its frontmatter", async () => {
		const t = await tools();
		const note = { type: "journal", title: "Standup", body: "Tests pass." };
		const first = await t.write.run(note, ctx());
		const second = await t.write.run({ ...note, title: "Later" }, ctx());
		expect([
			first.ok && first.value.created,
			second.ok && second.value.created,
		]).toEqual([true, false]);
		const text = await t.note(day(NOW));
		expect(text.match(/^---$/gm)).toHaveLength(2);
		expect(text).toMatch(/### Standup\n\nTests pass\.\n\n### Later\n/);
		expect(
			t.saved.map((e) => e.type === "vault.note.saved" && e.payload.noteType),
		).toEqual(["journal", "journal"]);
	});

	it("gives back the policy's ask and writes nothing", async () => {
		const t = await tools();
		t.policy.ask = true;
		expect(code(await t.write.run(lesson("Asked"), ctx()))).toBe(
			"approval_required",
		);
		expect(t.saved).toEqual([]);
	});

	it("refuses a title with no letter or digit, a type agents may not write and the personal vault", async () => {
		const t = await tools();
		expect(code(await t.write.run(lesson("!!!"), ctx()))).toBe("bad_input");
		expect(
			code(await t.write.run({ ...lesson("A"), type: "inbox" }, ctx())),
		).toBe("bad_input");
		expect(
			code(await t.write.run({ ...lesson("A"), scope: "personal" }, ctx())),
		).toBe("not_found");
	});
});

describe("vault.read@1", () => {
	const put = async (root: string, path: string, text: string) => {
		const file = join(root, ".mete", "knowledge", path);
		await mkdir(join(file, ".."), { recursive: true });
		await writeFile(file, text, "utf8");
	};

	it("never gives a private note to a model", async () => {
		const t = await tools();
		await put(
			t.root,
			"entities/me.md",
			"---\ntype: entity\nprivate: true\n---\n\nSecret.\n",
		);
		expect(code(await t.read.run({ path: "entities/me.md" }, ctx()))).toBe(
			"ignored",
		);
	});

	it("refuses paths that leave the vault or enter its history", async () => {
		const t = await tools();
		for (const path of [
			"../policy.yaml",
			"../x.md",
			".history/lessons/a.md/1.md",
			"/etc/a.md",
			"C:/a.md",
			"lessons/a.txt",
		])
			expect([path, code(await t.read.run({ path }, ctx()))]).toEqual([
				path,
				"bad_input",
			]);
	});

	it("answers not_found for a missing note and for the personal vault", async () => {
		const t = await tools();
		expect(code(await t.read.run({ path: "lessons/none.md" }, ctx()))).toBe(
			"not_found",
		);
		await put(t.root, "lessons/a.md", "A\n");
		expect(
			code(
				await t.read.run({ path: "lessons/a.md", scope: "personal" }, ctx()),
			),
		).toBe("not_found");
		expect(code(await t.read.run({ path: "lessons\\a.md" }, ctx()))).toBe("ok");
	});
});
