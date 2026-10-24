import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { describe, expect, it } from "vitest";
import { EndpointsForm } from "../src/infrastructure/endpoints-form.js";

// The custom endpoints card's files (ADR-087) over a fake file service: the global settings.yaml by
// default, the folder's .mete/providers.yaml on request, and a typed list that survives the switch.

const WORK = URI.fromFilePath("/w");
const GLOBAL = "/g/settings.yaml";
// The file service names files by their fsPath, which uses back slashes on Windows.
const GLOBAL_KEY = URI.fromFilePath(GLOBAL).path.fsPath();
const FOLDER_KEY = WORK.resolve(".mete/providers.yaml").path.fsPath();

const fakeFiles = (initial: Record<string, string>) => {
	const disk = new Map(Object.entries(initial));
	const files = {
		exists: async (u: URI) => disk.has(u.path.fsPath()),
		read: async (u: URI) => ({ value: disk.get(u.path.fsPath()) ?? "" }),
		write: async (u: URI, text: string) => void disk.set(u.path.fsPath(), text),
	} as unknown as FileService;
	return { files, disk };
};

const FOLDER_TEXT =
	"custom:\n  - slug: f\n    name: F\n    baseUrl: https://f.example\n    format: google-gemini\n";

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the custom endpoints card's files", () => {
	it("edits the global list by default, then saves the typed list to the folder file", async () => {
		const { files, disk } = fakeFiles({
			[GLOBAL_KEY]:
				"gateway:\n  models: both\nproviders:\n  custom:\n    - slug: a\n      name: A\n      baseUrl: https://a.example\n      format: openai-chat\n",
		});
		const form = new EndpointsForm(files, () => {});
		await form.load(WORK, GLOBAL);
		const card = () => form.form();
		expect(card()?.state.target).toBe("global");
		expect(card()?.state.file).toBe(GLOBAL_KEY);
		expect(card()?.state.list.map((e) => e.slug)).toEqual(["a"]);
		expect(card()?.state.dirty).toBe(false);
		card()?.actions.onAdd();
		for (const [field, value] of [
			["slug", "b"],
			["name", "B"],
			["baseUrl", "https://b.example"],
			["format", "anthropic-messages"],
		] as const)
			card()?.actions.onEdit(1, field, value);
		expect(card()?.state.dirty).toBe(true);
		card()?.actions.onSave();
		await settle();
		expect(disk.get(GLOBAL_KEY)).toContain("models: both");
		expect(disk.get(GLOBAL_KEY)).toContain("slug: b");
		expect(card()?.state.dirty).toBe(false);
		expect(card()?.state.note?.kind).toBe("saved");

		card()?.actions.onRemove(0);
		card()?.actions.onTarget("workspace");
		await settle();
		expect(card()?.state.file).toBe(FOLDER_KEY);
		expect(card()?.state.list.map((e) => e.slug)).toEqual(["b"]);
		card()?.actions.onSave();
		await settle();
		expect(disk.get(FOLDER_KEY)?.startsWith("custom:")).toBe(true);
		expect(disk.get(GLOBAL_KEY)).toContain("slug: a");
	});

	it("reads the target's own list when nothing was typed, and refuses what the schema refuses", async () => {
		const { files, disk } = fakeFiles({ [FOLDER_KEY]: FOLDER_TEXT });
		const form = new EndpointsForm(files, () => {});
		await form.load(WORK, GLOBAL);
		const card = () => form.form();
		expect(card()?.state.list).toEqual([]);
		card()?.actions.onTarget("workspace");
		await settle();
		expect(card()?.state.list.map((e) => e.slug)).toEqual(["f"]);
		card()?.actions.onAdd();
		card()?.actions.onSave();
		await settle();
		expect(card()?.state.note?.kind).toBe("refused");
		expect(card()?.state.busy).toBe(false);
		expect(disk.get(FOLDER_KEY)).toBe(FOLDER_TEXT);
	});
});
