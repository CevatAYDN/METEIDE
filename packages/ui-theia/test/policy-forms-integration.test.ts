import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { expect, it } from "vitest";
import { parse } from "yaml";
import { SettingsForms } from "../src/infrastructure/settings-forms.js";

it("retains invalid in-memory deny drafts and refuses to save them until repaired", async () => {
	const root = URI.fromFilePath("/workspace");
	const path = root.resolve(".mete/policy.yaml").path.fsPath();
	const disk = new Map([[path, "autonomy: 2\n"]]);
	const files = {
		exists: async (uri: URI) => disk.has(uri.path.fsPath()),
		read: async (uri: URI) => ({ value: disk.get(uri.path.fsPath()) ?? "" }),
		write: async (uri: URI, text: string) => {
			disk.set(uri.path.fsPath(), text);
		},
	};
	const forms = new SettingsForms(files as unknown as FileService, () => {});
	await forms.load(root, undefined);
	forms
		.forms()
		.policy?.actions.onField("never_allow", [
			{ action: "shell.exec", command: "" },
		]);
	await forms.saveAll();
	expect(disk.get(path)).toBe("autonomy: 2\n");
	expect(forms.forms().policy?.state.dirty).toBe(true);
	expect(forms.forms().policy?.state.values.never_allow).toEqual([
		{ action: "shell.exec", command: "" },
	]);
	expect(forms.forms().policy?.state.note?.kind).toBe("refused");
	forms
		.forms()
		.policy?.actions.onField("never_allow", [
			{ action: "shell.exec", command: "blocked *" },
		]);
	await forms.saveAll();
	expect(parse(disk.get(path) ?? "")).toEqual({
		autonomy: 2,
		never_allow: [{ action: "shell.exec", command: "blocked *" }],
	});
});

it("retains configured global overrides separately from schema default placeholders", async () => {
	const root = URI.fromFilePath("/workspace");
	const global = URI.fromFilePath("/global/settings.yaml");
	const files = {
		exists: async (uri: URI) => uri.toString() === global.toString(),
		read: async () => ({
			value: "policy:\n  autonomy: 3\n  overrides: { 'fs.write@1': 2 }\n",
		}),
	};
	const forms = new SettingsForms(files as unknown as FileService, () => {});
	await forms.load(root, global.path.fsPath());
	expect(forms.forms().policy?.state.inherited?.overrides).toEqual({
		"fs.write@1": 2,
	});
	expect(forms.forms().policy?.state.defaults.autonomy).toBe(3);
	expect(forms.forms().policy?.state.values.overrides).toBeUndefined();
});
