import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The main-process side of "Check for Updates…" (ADR-137) over a fake electron-updater: one check
// at a time, the download switched off, and Install hands over to the updater.

const fake = vi.hoisted(() => ({
	autoDownload: true,
	currentVersion: { version: "1.2.3" },
	checks: 0,
	settle: (() => {}) as (value: {
		isUpdateAvailable: boolean;
		updateInfo: { version: string };
	}) => void,
	checkForUpdates() {
		fake.checks++;
		return new Promise<{
			isUpdateAvailable: boolean;
			updateInfo: { version: string };
		}>((resolve) => {
			fake.settle = resolve;
		});
	},
	downloadUpdate: () => Promise.resolve(),
	quitAndInstall: vi.fn(),
}));

vi.mock("electron-updater", () => ({ autoUpdater: fake }));

// vi.mock is hoisted above every import, so the module under test sees the fake.
import { MeteUpdateMain } from "../src/infrastructure/update-main.js";

beforeEach(() => {
	fake.checks = 0;
	fake.autoDownload = true;
	fake.quitAndInstall.mockClear();
});

describe("the update main service", () => {
	it("shares one check between clicks while it runs, then checks again", async () => {
		const main = new MeteUpdateMain();
		const first = main.check();
		const second = main.check();
		expect(second).toBe(first);
		expect(fake.checks).toBe(1);
		expect(fake.autoDownload).toBe(false);
		fake.settle({ isUpdateAvailable: false, updateInfo: { version: "1.2.3" } });
		expect(await first).toEqual({ kind: "latest", current: "1.2.3" });
		const third = main.check();
		expect(third).not.toBe(first);
		expect(fake.checks).toBe(2);
		fake.settle({ isUpdateAvailable: true, updateInfo: { version: "2.0.0" } });
		expect(await third).toEqual({ kind: "ready", version: "2.0.0" });
	});

	it("installs through the updater", async () => {
		await new MeteUpdateMain().install();
		expect(fake.quitAndInstall).toHaveBeenCalledOnce();
	});
});
