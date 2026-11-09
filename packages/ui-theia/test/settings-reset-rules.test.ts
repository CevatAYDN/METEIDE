import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { expect, it } from "vitest";
import { parse } from "yaml";
import type { Draft } from "../src/application/section-draft.js";
import { SettingsForms } from "../src/infrastructure/settings-forms.js";
import { required } from "./required-fixture.js";

class Forms extends SettingsForms {
	resetPolicy() {
		return this.clear("policy");
	}
}
const root = URI.fromFilePath("/workspace");
const policy = root.resolve(".mete/policy.yaml").path.fsPath();
const global = URI.fromFilePath("/global/settings.yaml").path.fsPath();
const source =
	"autonomy: 1\nbudget: { max_hours: 2 }\nshell: { allow: [git status], always: [keep] }\n";
const setup = async () => {
	const disk = new Map([
		[policy, source],
		[global, "policy:\n  autonomy: 3\n"],
	]);
	const files = {
		exists: async (uri: URI) => disk.has(uri.path.fsPath()),
		read: async (uri: URI) => ({ value: disk.get(uri.path.fsPath()) ?? "" }),
		write: async (uri: URI, text: string) => {
			disk.set(uri.path.fsPath(), text);
		},
		delete: async (uri: URI) => {
			disk.delete(uri.path.fsPath());
		},
	};
	const forms = new Forms(files as unknown as FileService, () => {});
	await forms.load(root, global);
	const form = () => required(forms.forms().policy);
	return { forms, disk, form };
};
const rules: Draft = {
	always_ask: [],
	never_allow: [{ action: "shell.exec", command: "" }],
	"shell.allow": ["npm test"],
	"shell.always": undefined,
	overrides: { "shell.exec@1": 2 },
};

it("resets workspace scalars while retaining every pending rule key for repair and Save", async () => {
	const { forms, form, disk } = await setup();
	form().actions.onField("autonomy", 0);
	form().actions.onField("budget.max_hours", 5);
	for (const [key, value] of Object.entries(rules))
		form().actions.onField(key, value);
	await forms.resetPolicy();
	expect(parse(disk.get(policy) ?? "")).toEqual({
		shell: { allow: ["git status"], always: ["keep"] },
	});
	expect(form().state).toMatchObject({
		target: "workspace",
		dirty: true,
		readValid: true,
		values: rules,
	});
	expect(form().state.values.autonomy).toBeUndefined();
	expect(form().state.values["budget.max_hours"]).toBeUndefined();
	const afterReset = disk.get(policy);
	await forms.saveAll();
	expect(disk.get(policy)).toBe(afterReset);
	expect(form().state.note?.kind).toBe("refused");
	expect(form().state.values.never_allow).toEqual(rules.never_allow);
	form().actions.onField("never_allow", [
		{ action: "shell.exec", command: "blocked *" },
	]);
	await forms.saveAll();
	expect(parse(disk.get(policy) ?? "")).toEqual({
		always_ask: [],
		never_allow: [{ action: "shell.exec", command: "blocked *" }],
		shell: { allow: ["npm test"] },
		overrides: { "shell.exec@1": 2 },
	});
	expect(form().state.dirty).toBe(false);
	expect(parse(disk.get(global) ?? "")).toEqual({ policy: { autonomy: 3 } });
});

it("keeps global-target scalar and rule edits while Reset affects only the workspace file", async () => {
	const { forms, form, disk } = await setup();
	await forms.retargetAll("global");
	form().actions.onField("autonomy", 2);
	for (const [key, value] of Object.entries(rules))
		form().actions.onField(key, value);
	const globalBefore = disk.get(global);
	await forms.resetPolicy();
	expect(parse(disk.get(policy) ?? "")).toEqual({
		shell: { allow: ["git status"], always: ["keep"] },
	});
	expect(disk.get(global)).toBe(globalBefore);
	expect(form().state).toMatchObject({
		target: "global",
		dirty: true,
		values: { ...rules, autonomy: 2 },
	});
});
