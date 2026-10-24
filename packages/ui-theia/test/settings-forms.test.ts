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
