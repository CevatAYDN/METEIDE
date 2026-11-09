import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { PolicyFields } from "../src/application/policy-fields.js";
import { SettingsForms } from "../src/infrastructure/settings-forms.js";
import { required } from "./required-fixture.js";

const root = URI.fromFilePath("/workspace");
const policy = root.resolve(".mete/policy.yaml").path.fsPath();
const global = URI.fromFilePath("/global/settings.yaml").path.fsPath();
const good = "shell:\n  allow: [git status]\n";
const setup = () => {
	const disk = new Map([
		[policy, good],
		[global, "policy:\n  autonomy: 2\n"],
	]);
	const write = vi.fn(async (uri: URI, text: string) => {
		disk.set(uri.path.fsPath(), text);
	});
	let unread = false;
	const files = {
		exists: async (uri: URI) => disk.has(uri.path.fsPath()),
		read: async (uri: URI) => {
			if (unread && uri.path.fsPath() === policy) throw new Error("Unread");
			return { value: disk.get(uri.path.fsPath()) ?? "" };
		},
		write,
		delete: vi.fn(),
	};
	const forms = new SettingsForms(files as unknown as FileService, () => {});
	const form = () => required(forms.forms().policy);
	const html = () =>
		renderToStaticMarkup(
			createElement(PolicyFields, {
				state: form().state,
				onField: form().actions.onField,
			}),
		);
	return {
		forms,
		form,
		html,
		disk,
		write,
		unread: (value: boolean) => {
			unread = value;
		},
	};
};

it.each(["workspace list", "global list", "read failure"])(
	"keeps %s unavailable after a scalar edit and refuses a fallback Custom attempt",
	async (failure) => {
		const t = setup();
		await t.forms.load(root, global);
		expect(t.form().state.readValid).toBe(true);
		if (failure === "workspace list")
			t.disk.set(policy, "shell:\n  allow: [git status, 7]\n");
		else if (failure === "global list")
			t.disk.set(global, "policy:\n  always_ask: [git.push, unknown.action]\n");
		else t.unread(true);
		await t.forms.load(root, global);
		expect(t.form().state.readValid).toBe(false);
		t.form().actions.onField("autonomy", 3);
		expect(t.form().state.dirty).toBe(true);
		expect(t.form().state.readValid).toBe(false);
		expect(t.html()).toContain("Rules are unavailable");
		expect(t.html()).not.toContain("<select");
		// Even a callback attempting to customize fallback rules cannot replace unread rows.
		t.form().actions.onField("shell.allow", []);
		expect(t.form().state.values["shell.allow"]).toBeUndefined();
		t.unread(false);
		t.disk.set(policy, good);
		t.disk.set(global, "policy:\n  autonomy: 2\n");
		t.form().actions.onSave();
		await t.forms.saveAll();
		expect(t.write).not.toHaveBeenCalled();
		expect(t.disk.get(policy)).toBe(good);
		expect(t.form().state.readValid).toBe(false);
		await t.forms.load(root, global);
		expect(t.form().state.readValid).toBe(true);
		expect(t.form().state.values["shell.allow"]).toEqual(["git status"]);
		expect(t.html()).not.toContain("Rules are unavailable");
	},
);

it("keeps successfully read, incomplete in-memory rules repairable after a refused Save", async () => {
	const t = setup();
	await t.forms.load(root, global);
	t.form().actions.onField("never_allow", [
		{ action: "shell.exec", command: "" },
	]);
	await t.forms.saveAll();
	expect(t.form().state).toMatchObject({
		readValid: true,
		dirty: true,
		note: { kind: "refused" },
	});
	expect(t.html()).toContain("A path or command pattern is missing or invalid");
	expect(t.html()).not.toContain("Rules are unavailable");
	t.form().actions.onField("never_allow", [
		{ action: "shell.exec", command: "blocked *" },
	]);
	await t.forms.saveAll();
	expect(t.write).toHaveBeenCalledOnce();
	expect(t.form().state).toMatchObject({ readValid: true, dirty: false });
	expect(t.form().state.values["shell.allow"]).toEqual(["git status"]);
});
