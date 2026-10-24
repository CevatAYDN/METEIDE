import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { describe, expect, it } from "vitest";
import { SettingsForms } from "../src/infrastructure/settings-forms.js";

// The Settings forms' files (ADR-082) over a fake file service: what the user typed survives a change
// of target, and Save writes only into the file it names.

const WORK = URI.fromFilePath("/w");
const GLOBAL = "/g/settings.yaml";
// The file service names files by their fsPath, which uses back slashes on Windows.
const GLOBAL_KEY = URI.fromFilePath(GLOBAL).path.fsPath();

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

describe("the Settings forms' files", () => {
	it("keeps typed values when the target changes, and saves them to the new target only", async () => {
		const workFile = WORK.resolve(".mete/gateway.yaml").path.fsPath();
		const { files, disk } = fakeFiles({
			[workFile]: "models: free\n",
			[GLOBAL_KEY]: "privacy:\n  allowTraining: true\n",
		});
		const forms = new SettingsForms(files, () => {});
		await forms.load(WORK, GLOBAL);
		const gateway = () => forms.forms().gateway;
		expect(gateway()?.state.dirty).toBe(false);
		gateway()?.actions.onField("dailySpendUsd", 3);
		expect(gateway()?.state.dirty).toBe(true);
		gateway()?.actions.onTarget("global");
		await new Promise((r) => setTimeout(r, 0));
		expect(gateway()?.state.values).toEqual({
			models: undefined,
			dailySpendUsd: 3,
		});
		expect(gateway()?.state.dirty).toBe(true);
		gateway()?.actions.onSave();
		await new Promise((r) => setTimeout(r, 0));
		expect(disk.get(GLOBAL_KEY)).toBe(
			"privacy:\n  allowTraining: true\ngateway:\n  dailySpendUsd: 3\n",
		);
		expect(disk.get(workFile)).toBe("models: free\n");
		expect(gateway()?.state.dirty).toBe(false);
	});
});

describe("the scope switch and Reset (ADR-095)", () => {
	const workFile = (s: string) => WORK.resolve(`.mete/${s}.yaml`).path.fsPath();
	const settle = () => new Promise((r) => setTimeout(r, 0));

	it("moves every form to the other target at once, each keeping what was typed", async () => {
		const { files } = fakeFiles({
			[GLOBAL_KEY]: "privacy:\n  allowTraining: true\npolicy:\n  autonomy: 1\n",
		});
		const forms = new SettingsForms(files, () => {});
		await forms.load(WORK, GLOBAL);
		forms.forms().gateway?.actions.onField("dailySpendUsd", 2);
		await forms.retargetAll("global");
		const states = Object.values(forms.forms()).map((f) => f.state);
		expect(states).toHaveLength(3);
		expect(states.map((s) => s.target)).toEqual(["global", "global", "global"]);
		expect(forms.forms().privacy?.state.values.allowTraining).toBe(true);
		expect(forms.forms().policy?.state.values.autonomy).toBe(1);
		expect(forms.forms().gateway?.state.values.dailySpendUsd).toBe(2);
	});

	it("clears the form's keys from this folder's file, leaves no empty map and keeps its other keys", async () => {
		const policy = workFile("policy");
		const { files, disk } = fakeFiles({
			[policy]: "autonomy: 3\nbudget:\n  max_hours: 2\nshell:\n  allow: [ls]\n",
		});
		const forms = new SettingsForms(files, () => {});
		await forms.load(WORK, GLOBAL);
		forms.forms().policy?.actions.onClear();
		await settle();
		const left = disk.get(policy) ?? "";
		expect(left).toContain("shell:");
		expect(left).toContain("ls");
		expect(left).not.toMatch(/autonomy|budget|\{\}/);
		const state = forms.forms().policy?.state;
		expect(state?.values.autonomy).toBeUndefined();
		expect(state?.note?.kind).toBe("saved");
	});

	it("clears the folder's file whichever target the form shows, and leaves what was typed for the global file", async () => {
		const gateway = workFile("gateway");
		const { files, disk } = fakeFiles({
			[gateway]: "models: free\n",
			[GLOBAL_KEY]: "",
		});
		const forms = new SettingsForms(files, () => {});
		await forms.load(WORK, GLOBAL);
		await forms.retargetAll("global");
		forms.forms().gateway?.actions.onField("dailySpendUsd", 5);
		forms.forms().gateway?.actions.onClear();
		await settle();
		// The file held only this form's key, so it goes: an empty file would still be a layer.
		expect(disk.has(gateway)).toBe(false);
		expect(disk.get(GLOBAL_KEY)).toBe("");
		expect(forms.forms().gateway?.state.target).toBe("global");
		expect(forms.forms().gateway?.state.values.dailySpendUsd).toBe(5);
		expect(forms.forms().gateway?.state.dirty).toBe(true);
	});

	it("says why when the folder's file is not valid YAML, and writes nothing", async () => {
		const gateway = workFile("gateway");
		const { files, disk } = fakeFiles({ [gateway]: "models: [\n" });
		const forms = new SettingsForms(files, () => {});
		await forms.load(WORK, GLOBAL);
		forms.forms().gateway?.actions.onClear();
		await settle();
		expect(disk.get(gateway)).toBe("models: [\n");
		expect(forms.forms().gateway?.state.note?.kind).toBe("refused");
	});
});

describe("the one save bar (ADR-095)", () => {
	const settle = () => new Promise((r) => setTimeout(r, 0));
	const fileOf = (s: string) => WORK.resolve(`.mete/${s}.yaml`).path.fsPath();

	it("saves every changed form to its own file and leaves a clean form's file alone", async () => {
		const { files, disk } = fakeFiles({ [fileOf("policy")]: "autonomy: 1\n" });
		const forms = new SettingsForms(files, () => {});
		await forms.load(WORK, GLOBAL);
		forms.forms().gateway?.actions.onField("dailySpendUsd", 2);
		forms.forms().policy?.actions.onField("autonomy", 3);
		await forms.saveAll();
		expect(disk.get(fileOf("gateway"))).toBe("dailySpendUsd: 2\n");
		expect(disk.get(fileOf("policy"))).toBe("autonomy: 3\n");
		expect(disk.has(fileOf("privacy"))).toBe(false);
		const states = Object.values(forms.forms()).map((f) => f.state.dirty);
		expect(states).toEqual([false, false, false]);
	});

	it("keeps a refused form changed, with its note, and still saves the others", async () => {
		const { files, disk } = fakeFiles({ [fileOf("policy")]: "autonomy: [\n" });
		const forms = new SettingsForms(files, () => {});
		await forms.load(WORK, GLOBAL);
		forms.forms().gateway?.actions.onField("dailySpendUsd", 2);
		forms.forms().policy?.actions.onField("autonomy", 3);
		await forms.saveAll();
		await settle();
		expect(disk.get(fileOf("gateway"))).toBe("dailySpendUsd: 2\n");
		expect(disk.get(fileOf("policy"))).toBe("autonomy: [\n");
		const policy = forms.forms().policy?.state;
		expect(policy?.dirty).toBe(true);
		expect(policy?.note?.kind).toBe("refused");
		expect(forms.forms().gateway?.state.note?.kind).toBe("saved");
	});

	it("does nothing when no form changed", async () => {
		const { files, disk } = fakeFiles({});
		const forms = new SettingsForms(files, () => {});
		await forms.load(WORK, GLOBAL);
		await forms.saveAll();
		expect(disk.size).toBe(0);
	});
});

describe("a file an edit leaves with no key (ADR-095)", () => {
	const fileOf = (s: string) => WORK.resolve(`.mete/${s}.yaml`).path.fsPath();
	const settle = () => new Promise((r) => setTimeout(r, 0));

	it("is deleted when Save clears its last field, so it stays no empty layer", async () => {
		const { files, disk } = fakeFiles({
			[fileOf("gateway")]: "dailySpendUsd: 2\n",
		});
		const forms = new SettingsForms(files, () => {});
		await forms.load(WORK, GLOBAL);
		forms.forms().gateway?.actions.onField("dailySpendUsd", undefined);
		await forms.saveAll();
		expect(disk.has(fileOf("gateway"))).toBe(false);
		expect(forms.forms().gateway?.state.note?.kind).toBe("saved");
	});

	it("is left alone when it held no key: a missing, empty or comment-only file is not written or removed", async () => {
		const { files, disk } = fakeFiles({
			[fileOf("policy")]: "# my notes\n",
			[fileOf("privacy")]: "",
		});
		const forms = new SettingsForms(files, () => {});
		await forms.load(WORK, GLOBAL);
		for (const s of ["gateway", "policy", "privacy"] as const)
			forms.forms()[s]?.actions.onClear();
		await settle();
		expect(disk.has(fileOf("gateway"))).toBe(false);
		expect(disk.get(fileOf("policy"))).toBe("# my notes\n");
		expect(disk.get(fileOf("privacy"))).toBe("");
	});
});
