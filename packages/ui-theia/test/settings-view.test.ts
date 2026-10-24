import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SET_KEY_COMMAND } from "../src/application/key-command.js";
import { shortPath } from "../src/application/settings-form.js";
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
			actions: {
				onApply: none,
				onCommand: none,
				onOpen: none,
				onRefresh: none,
			},
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
		// A folder's file is named from .mete on, whole in the tooltip; the global file stays whole.
		expect(gateway).toContain(
			'title="/w/.mete/gateway.yaml">.mete/gateway.yaml<',
		);
		expect(out).toContain("max-width:760px");
		const mcp = out.slice(out.indexOf('aria-label="mcp"'));
		expect(mcp).toContain("servers: []");
		expect(mcp).not.toContain("Global:");
		// One file: its value once, no merged block; two files: the merged value first.
		expect(mcp.match(/servers: \[\]/g)).toHaveLength(1);
		expect(mcp).not.toContain("What METE uses:");
		expect(gateway).toContain("What METE uses:");
		expect(out).toContain("Edits to these files apply when METE starts again");
		// Pins are read when a task is seated (ADR-077), so they need no restart.
		expect(out).toContain("except pins, which apply when the next task starts");
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

describe("the Settings forms (ADR-082)", () => {
	const gatewayForm = {
		state: {
			target: "workspace" as const,
			file: "/w/.mete/gateway.yaml",
			values: { models: "both", dailySpendUsd: undefined },
			defaults: { models: "free", dailySpendUsd: 1 },
			busy: false,
			dirty: false,
		},
		actions: { onField: none, onTarget: none, onSave: none },
	};
	const withForms = (model: SettingsModel) =>
		renderToStaticMarkup(
			createElement(SettingsView, {
				model,
				actions: {
					onApply: none,
					onCommand: none,
					onOpen: none,
					onRefresh: none,
				},
				forms: { gateway: gatewayForm },
			}),
		);

	it("always shows the gateway, policy and privacy sections, and a form where it has one", () => {
		const out = withForms(LOADED);
		for (const name of ["gateway", "policy", "privacy"])
			expect(out).toContain(`aria-label="${name}"`);
		const policy = out.slice(out.indexOf('aria-label="policy"'));
		expect(policy).toContain("No file sets this section; its defaults apply.");
		const gateway = out.slice(
			out.indexOf('aria-label="gateway"'),
			out.indexOf('aria-label="mcp"'),
		);
		expect(gateway).toContain(
			'<label for="mete-setting-models">Models</label>',
		);
		expect(gateway).toContain(
			'<option value="both" selected="">Free first, then paid</option>',
		);
		expect(gateway).toContain('placeholder="Default (1)"');
		expect(gateway).toContain(
			'title="/w/.mete/gateway.yaml">Saves to .mete/gateway.yaml<',
		);
		expect(shortPath(String.raw`C:\w\.mete\policy.yaml`)).toBe(
			String.raw`.mete\policy.yaml`,
		);
		expect(
			shortPath(String.raw`C:\Users\me\AppData\Roaming\METE\settings.yaml`),
		).toBe(String.raw`C:\Users\me\AppData\Roaming\METE\settings.yaml`);
		// Save waits for a change, so an untouched file is never rewritten.
		expect(gateway).toMatch(
			/<button type="button" class="mete-button" disabled="">Save<\/button>/,
		);
	});

	it("turns the global save off when the daemon names no global file", () => {
		const out = withForms(LOADED);
		expect(out).toMatch(
			/<input type="checkbox" disabled=""\/>Save for every folder/,
		);
		const global = withForms({
			kind: "settings",
			settings: { ...LOADED.settings, globalFile: "/g/settings.yaml" },
		} as SettingsModel);
		expect(global).toMatch(/<input type="checkbox"\/>Save for every folder/);
	});
});

describe("Apply now (ADR-083)", () => {
	const withApply = (activeRuns: number) =>
		renderToStaticMarkup(
			createElement(SettingsView, {
				model: LOADED,
				actions: {
					onApply: none,
					onCommand: none,
					onOpen: none,
					onRefresh: none,
				},
				apply: { busy: false, activeRuns },
			}),
		);

	it("is on while no run runs, and off with the reason while one does", () => {
		expect(withApply(0)).toContain(
			'<button type="button" class="mete-button">Apply now</button>',
		);
		const busy = withApply(1);
		expect(busy).toContain(
			'<button type="button" class="mete-button" disabled="">Apply now</button>',
		);
		expect(busy).toContain("Apply now waits until it is paused or ends.");
	});
});

describe("the custom endpoints card (ADR-087)", () => {
	const withEndpoints = (
		target: "global" | "workspace",
		activeRuns?: number,
		dirty = false,
	) =>
		renderToStaticMarkup(
			createElement(SettingsView, {
				model: LOADED,
				actions: {
					onApply: none,
					onCommand: none,
					onOpen: none,
					onRefresh: none,
				},
				endpoints: {
					state: {
						target,
						file: "/g/settings.yaml",
						list: [
							{
								slug: "my-lab",
								name: "My lab",
								baseUrl: "https://lab.example/v1",
								format: "openai-chat",
								headers: "X-Team: blue",
							},
						],
						busy: false,
						dirty,
					},
					actions: {
						onEdit: none,
						onAdd: none,
						onRemove: none,
						onTarget: none,
						onSave: none,
					},
					...(activeRuns === undefined
						? {}
						: {
								keys: {
									stateOf: () => ({ key: "sk-typed", busy: false }),
									onType: none,
									onSet: none,
									activeRuns,
								},
							}),
				},
			}),
		);

	it("shows the providers section with each endpoint's fields, saving globally unless asked", () => {
		const out = withEndpoints("global");
		const card = out.slice(out.indexOf('aria-label="providers"'));
		for (const label of ["Name", "Slug", "Base URL", "API format", "Remove"])
			expect(card).toContain(label);
		expect(card).toContain('value="https://lab.example/v1"');
		expect(card).toContain('<option value="openai-chat" selected="">');
		expect(card).toContain("X-Team: blue</textarea>");
		expect(card).toMatch(/<input type="checkbox"\/>Save for this folder only/);
		expect(card).toContain("hides the global endpoints in this folder");
		expect(card).toContain("Add endpoint");
		expect(withEndpoints("workspace")).toMatch(
			/<input type="checkbox" checked=""\/>Save for this folder only/,
		);
	});

	it("has a masked key field whose Set key waits while a run is queued or running", () => {
		const idle = withEndpoints("global", 0);
		expect(idle).toMatch(/<input id="mete-endpoint-0-key"[^>]*type="password"/);
		expect(idle).toContain(
			'<button type="button" class="mete-button">Set key</button>',
		);
		const busy = withEndpoints("global", 1);
		expect(busy).toContain(
			'<button type="button" class="mete-button" disabled="">Set key</button>',
		);
		expect(busy).toContain("setting a key restarts METE");
		// A key restarts METE, which reloads the card, so unsaved edits are saved first.
		expect(withEndpoints("global", 0, true)).toContain(
			'<button type="button" class="mete-button" disabled="">Set key</button>',
		);
	});
});
