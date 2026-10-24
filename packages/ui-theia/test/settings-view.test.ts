import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SET_KEY_COMMAND } from "../src/application/key-command.js";
import {
	SETTINGS_LINKS,
	type SettingsModel,
	SettingsView,
} from "../src/application/settings-view.js";

// The read-only Settings screen (ADR-081) rendered to HTML on Node.

const none = () => {};
const html = (model: SettingsModel) =>
	renderToStaticMarkup(
		createElement(SettingsView, {
			model,
			actions: { onCommand: none, onOpen: none, onRefresh: none },
		}),
	);

const LOADED: SettingsModel = {
	kind: "settings",
	settings: {
		loadedAt: "2026-10-24T10:00:00.000Z",
		sections: [
			{
				name: "gateway",
				merged: { models: "both" },
				global: { file: "/g/settings.yaml", value: { models: "free" } },
				workspace: { file: "/w/.mete/gateway.yaml", value: { models: "both" } },
			},
			{
				name: "mcp",
				merged: { servers: [] },
				workspace: { file: "/w/.mete/mcp.yaml", value: { servers: [] } },
			},
		],
	},
};

describe("the Settings screen", () => {
	it("shows each section merged and each file's value under its path, as YAML", () => {
		const out = html(LOADED);
		const gateway = out.slice(
			out.indexOf('aria-label="gateway"'),
			out.indexOf('aria-label="mcp"'),
		);
		expect(gateway).toContain("models: both");
		expect(gateway).toContain("models: free");
		expect(gateway).toContain('title="/g/settings.yaml">/g/settings.yaml<');
		expect(gateway).toContain('title="/w/.mete/gateway.yaml">');
		const mcp = out.slice(out.indexOf('aria-label="mcp"'));
		expect(mcp).toContain("servers: []");
		expect(mcp).not.toContain("Global:");
		// One file: its value once, no merged block; two files: the merged value first.
		expect(mcp.match(/servers: \[\]/g)).toHaveLength(1);
		expect(mcp).not.toContain("What METE uses:");
		expect(gateway).toContain("What METE uses:");
		expect(out).toContain("Edits to these files apply when METE starts again");
	});

	it("leads to the team editor, provider keys and Theia's preferences and language", () => {
		const out = html({ kind: "loading" });
		for (const [, label] of SETTINGS_LINKS)
			expect(out).toContain(`>${label()}<`);
		expect(SETTINGS_LINKS.map(([id]) => id)).toContain(SET_KEY_COMMAND.id);
		expect(out).toContain("Asking the METE daemon…");
	});

	it("says why it has nothing to show", () => {
		expect(html({ kind: "no_folder" })).toContain("Open a folder first");
		const failed = html({
			kind: "failed",
			failure: { code: "stopped", detail: "exit code 1" },
		});
		expect(failed).toContain('role="alert"');
	});
});
