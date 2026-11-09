import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { describe, expect, it } from "vitest";
import type { FormSection, Target } from "../src/application/section-draft.js";
import { SettingsForms } from "../src/infrastructure/settings-forms.js";
import { required } from "./required-fixture.js";

class Forms extends SettingsForms {
	retargetOne(section: FormSection, target: Target) {
		return this.retarget(section, target);
	}
}

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
const a = URI.fromFilePath("/workspace-a");
const b = URI.fromFilePath("/workspace-b");
const key = (root: URI) => root.resolve(".mete/gateway.yaml").path.fsPath();

const setup = () => {
	const disk = new Map([
		[key(a), "models: free\n"],
		[key(b), "models: both\n"],
	]);
	const writes: string[] = [];
	let held:
		| {
				path: string;
				skip: number;
				started: ReturnType<typeof deferred>;
				release: ReturnType<typeof deferred>;
		  }
		| undefined;
	const files = {
		exists: async (uri: URI) => disk.has(uri.path.fsPath()),
		read: async (uri: URI) => {
			const path = uri.path.fsPath();
			const value = disk.get(path) ?? "";
			if (held?.path === path && held.skip > 0) held.skip--;
			else if (held?.path === path) {
				const wait = held;
				held = undefined;
				wait.started.resolve();
				await wait.release.promise;
			}
			return { value };
		},
		write: async (uri: URI, text: string) => {
			writes.push(uri.path.fsPath());
			disk.set(uri.path.fsPath(), text);
		},
		delete: async (uri: URI) => {
			writes.push(uri.path.fsPath());
			disk.delete(uri.path.fsPath());
		},
	};
	return {
		disk,
		writes,
		forms: new Forms(files as unknown as FileService, () => {}),
		hold: (path: string, skip = 0) => {
			const wait = { path, skip, started: deferred(), release: deferred() };
			held = wait;
			return wait;
		},
	};
};

describe("settings form ownership", () => {
	it.each(["one form", "all forms"])(
		"retires the remaining save batch when %s retarget during the first read",
		async (scope) => {
			const { forms, disk, writes, hold } = setup();
			const global = URI.fromFilePath("/global/settings.yaml");
			const original = "policy:\n  always_ask: [git.merge]\n";
			disk.set(global.path.fsPath(), original);
			await forms.load(a, global.path.fsPath());
			required(forms.forms().gateway).actions.onField("models", "paid");
			required(forms.forms().policy).actions.onField("always_ask", []);
			const wait = hold(key(a));
			const saving = forms.saveAll();
			await wait.started.promise;
			if (scope === "one form") await forms.retargetOne("policy", "global");
			else await forms.retargetAll("global");
			wait.release.resolve();
			await saving;
			expect(disk.get(global.path.fsPath())).toBe(original);
			expect(writes).not.toContain(global.path.fsPath());
			expect(writes).toEqual([]);
			expect(forms.forms().policy?.state).toMatchObject({
				target: "global",
				dirty: true,
				values: { always_ask: [] },
			});
			await forms.saveAll();
			expect(disk.get(global.path.fsPath())).toContain("always_ask: []");
			expect(forms.forms().policy?.state.dirty).toBe(false);
		},
	);

	it("stops a pending form write when the outer Save-click revision retires", async () => {
		const { forms, hold, writes } = setup();
		await forms.load(a, undefined);
		required(forms.forms().gateway).actions.onField("models", "paid");
		let current = true;
		const wait = hold(key(a));
		const saving = forms.saveAll(() => current);
		await wait.started.promise;
		current = false;
		wait.release.resolve();
		await saving;
		expect(writes).toEqual([]);
		expect(forms.forms().gateway?.state).toMatchObject({
			busy: false,
			dirty: true,
		});
		expect(forms.forms().gateway?.state.note?.kind).not.toBe("saved");
	});

	it("does not publish a late saved note after retirement during the save reread", async () => {
		const { forms, hold, writes } = setup();
		await forms.load(a, undefined);
		required(forms.forms().gateway).actions.onField("models", "paid");
		let current = true;
		const wait = hold(key(a), 1);
		const saving = forms.saveAll(() => current);
		await wait.started.promise;
		expect(writes).toEqual([key(a)]);
		current = false;
		wait.release.resolve();
		await saving;
		expect(forms.forms().gateway?.state).toMatchObject({
			busy: false,
			dirty: true,
		});
		expect(forms.forms().gateway?.state.note?.kind).not.toBe("saved");
	});

	it("does not apply an old workspace read after a new workspace has loaded", async () => {
		const { forms, hold } = setup();
		const wait = hold(key(a));
		const oldLoad = forms.load(a, undefined);
		await wait.started.promise;
		await forms.load(b, undefined);
		wait.release.resolve();
		await oldLoad;
		expect(forms.forms().gateway?.state.file).toBe(key(b));
		expect(forms.forms().gateway?.state.values.models).toBe("both");
	});

	it("retires callbacks rendered for the previous workspace", async () => {
		const { forms, writes } = setup();
		await forms.load(a, undefined);
		const old = required(forms.forms().gateway).actions;
		await forms.load(b, undefined);
		old.onField("models", "paid");
		old.onSave();
		old.onClear();
		old.onTarget("global");
		await forms.saveAll();
		expect(forms.forms().gateway?.state).toMatchObject({
			file: key(b),
			target: "workspace",
			dirty: false,
			values: { models: "both" },
		});
		expect(writes).toEqual([]);
	});

	it("refuses a pending save before dispatch when its workspace changes during the read", async () => {
		const { forms, hold, writes, disk } = setup();
		await forms.load(a, undefined);
		forms.forms().gateway?.actions.onField("models", "paid");
		const wait = hold(key(a));
		const save = forms.saveAll();
		await wait.started.promise;
		await forms.load(b, undefined);
		wait.release.resolve();
		await save;
		expect(writes).toEqual([]);
		expect(disk.get(key(a))).toBe("models: free\n");
		expect(forms.forms().gateway?.state.values.models).toBe("both");
	});

	it("invalidates old actions immediately, before the next folder is resolved", async () => {
		const { forms, writes } = setup();
		await forms.load(a, undefined);
		const old = required(forms.forms().gateway).actions;
		forms.invalidate();
		old.onField("models", "paid");
		old.onSave();
		old.onClear();
		await forms.saveAll();
		expect(forms.forms()).toEqual({});
		expect(writes).toEqual([]);
	});

	it("retires old target callbacks after an explicit scope change", async () => {
		const { forms, writes } = setup();
		await forms.load(a, "/global/settings.yaml");
		const old = required(forms.forms().gateway).actions;
		await forms.retargetAll("global");
		old.onField("models", "paid");
		old.onSave();
		await forms.saveAll();
		expect(forms.forms().gateway?.state.target).toBe("global");
		expect(forms.forms().gateway?.state.dirty).toBe(false);
		expect(writes).toEqual([]);
	});
});
