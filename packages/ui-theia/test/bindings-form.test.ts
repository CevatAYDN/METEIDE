import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { BindingsForm } from "../src/infrastructure/bindings-form.js";

// The bindings card's file (ADR-096) over a fake file service: rows read from the file the card
// shows, the scope switch keeping what was typed, and Save writing only into the file it names.

const WORK = URI.fromFilePath("/w");
const GLOBAL = "/g/settings.yaml";
// The file service names files by their fsPath, which uses back slashes on Windows.
const GLOBAL_KEY = URI.fromFilePath(GLOBAL).path.fsPath();
const WORK_KEY = WORK.resolve(".mete/bindings.yaml").path.fsPath();

const fakeFiles = (initial: Record<string, string>) => {
	const disk = new Map(Object.entries(initial));
	const files = {
		exists: async (u: URI) => disk.has(u.path.fsPath()),
		read: async (u: URI) => ({ value: disk.get(u.path.fsPath()) ?? "" }),
		write: async (u: URI, text: string) => void disk.set(u.path.fsPath(), text),
		delete: async (u: URI) => void disk.delete(u.path.fsPath()),
	} as unknown as FileService;
	return { files, disk };
};

const formOver = async (initial: Record<string, string>) => {
	const { files, disk } = fakeFiles(initial);
	const form = new BindingsForm(files, () => {});
	await form.load(WORK, GLOBAL);
	return { form, disk };
};

const stateOf = (form: BindingsForm) => form.form()?.state;
const actionsOf = (form: BindingsForm) => form.form()?.actions;

describe("the bindings card's file", () => {
	it("reads this folder's file as rows, and saves what the user typed into it", async () => {
		const { form, disk } = await formOver({
			[WORK_KEY]: "web.search@1: [exa-mcp]\n",
		});
		expect(stateOf(form)?.rows).toEqual([
			{ capability: "web.search@1", adapters: "exa-mcp" },
		]);
		expect(stateOf(form)?.dirty).toBe(false);
		actionsOf(form)?.onRow(0, "adapters", "exa-mcp, tavily");
		actionsOf(form)?.onAdd();
		actionsOf(form)?.onRow(1, "capability", "3d.cleanup@1");
		actionsOf(form)?.onRow(1, "adapters", "blender-mcp");
		expect(stateOf(form)?.dirty).toBe(true);
		await form.save();
		expect(parse(disk.get(WORK_KEY) ?? "")).toEqual({
			"web.search@1": ["exa-mcp", "tavily"],
			"3d.cleanup@1": ["blender-mcp"],
		});
		expect(stateOf(form)?.dirty).toBe(false);
		expect(stateOf(form)?.note?.kind).toBe("saved");
	});

	it("keeps what was typed when the scope switch moves it to all folders", async () => {
		const { form, disk } = await formOver({
			[GLOBAL_KEY]: "gateway:\n  models: free\n",
		});
		actionsOf(form)?.onAdd();
		actionsOf(form)?.onRow(0, "capability", "web.search@1");
		actionsOf(form)?.onRow(0, "adapters", "tavily");
		await form.retarget("global");
		expect(stateOf(form)?.target).toBe("global");
		expect(stateOf(form)?.rows).toEqual([
			{ capability: "web.search@1", adapters: "tavily" },
		]);
		expect(stateOf(form)?.dirty).toBe(true);
		await form.save();
		expect(parse(disk.get(GLOBAL_KEY) ?? "")).toEqual({
			gateway: { models: "free" },
			bindings: { "web.search@1": ["tavily"] },
		});
		expect(disk.has(WORK_KEY)).toBe(false);
	});

	it("writes nothing and keeps the rows when a capability id is refused", async () => {
		const { form, disk } = await formOver({
			[WORK_KEY]: "web.search@1: [exa-mcp]\n",
		});
		actionsOf(form)?.onRow(0, "capability", "web-search");
		await form.save();
		expect(disk.get(WORK_KEY)).toBe("web.search@1: [exa-mcp]\n");
		expect(stateOf(form)?.note?.kind).toBe("refused");
		expect(stateOf(form)?.dirty).toBe(true);
	});

	it("deletes the folder's file when the last row goes, so it stays no empty layer", async () => {
		const { form, disk } = await formOver({
			[WORK_KEY]: "web.search@1: [exa-mcp]\n",
		});
		actionsOf(form)?.onRemove(0);
		await form.save();
		expect(disk.has(WORK_KEY)).toBe(false);
		expect(stateOf(form)?.rows).toEqual([]);
		expect(stateOf(form)?.note?.kind).toBe("saved");
	});

	it("says why when the file is not valid YAML, and writes nothing", async () => {
		const { form, disk } = await formOver({ [WORK_KEY]: "web.search@1: [\n" });
		expect(stateOf(form)?.note?.kind).toBe("refused");
		actionsOf(form)?.onAdd();
		await form.save();
		expect(disk.get(WORK_KEY)).toBe("web.search@1: [\n");
	});
});
