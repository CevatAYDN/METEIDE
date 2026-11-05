import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";

// The hardened main application (ADR-175) over fakes: the sandbox goes over Theia's window
// options without dropping the rest, and the CSP contribution installs through the session hook.

const fake = vi.hoisted(() => ({
	listeners: [] as unknown[],
	webRequest: {
		onHeadersReceived(listener: unknown) {
			fake.listeners.push(listener);
		},
	},
}));

vi.mock("@theia/core/electron-shared/electron", () => ({
	session: { defaultSession: { webRequest: fake.webRequest } },
}));

// Theia's class requires Electron and yargs at load; a stand-in with the same getter names suffices.
vi.mock("@theia/core/lib/electron-main/electron-main-application", () => ({
	ElectronMainApplication: class {
		protected getDefaultOptions() {
			return {
				show: false,
				webPreferences: {
					contextIsolation: true,
					sandbox: false,
					preload: "p",
				},
			};
		}
		protected getDefaultTheiaWindowOptions() {
			return { ...this.getDefaultOptions(), isMaximized: false };
		}
	},
	ElectronMainApplicationContribution: Symbol("contribution"),
}));

import {
	CspContribution,
	HardenedMainApplication,
	withSandbox,
} from "../src/infrastructure/hardened-main-application.js";

type Getters = {
	getDefaultOptions(): { webPreferences?: Record<string, unknown> };
	getDefaultTheiaWindowOptions(): {
		isMaximized?: boolean;
		webPreferences?: Record<string, unknown>;
	};
};

describe("HardenedMainApplication", () => {
	const app = new HardenedMainApplication() as unknown as Getters;

	it("turns the sandbox on and keeps Theia's other preferences", () => {
		expect(app.getDefaultOptions().webPreferences).toEqual({
			contextIsolation: true,
			sandbox: true,
			preload: "p",
		});
		const main = app.getDefaultTheiaWindowOptions();
		expect(main.isMaximized).toBe(false);
		expect(main.webPreferences?.sandbox).toBe(true);
	});

	it("adds the preference to options without any", () => {
		expect(withSandbox({ show: true }).webPreferences).toEqual({
			sandbox: true,
		});
	});
});

describe("CspContribution", () => {
	it("installs the policy on the default session at start", () => {
		const contribution = new CspContribution();
		Object.assign(contribution, {
			globals: { THEIA_FRONTEND_HTML_PATH: "/app/lib/frontend/index.html" },
		});
		contribution.onStart({} as never);
		expect(fake.listeners).toHaveLength(1);
	});
});
