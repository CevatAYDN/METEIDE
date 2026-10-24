import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EndpointTestState } from "../src/application/endpoint-test.js";
import { SET_KEY_COMMAND } from "../src/application/key-command.js";
import type { Target } from "../src/application/section-draft.js";
import { type FormState, shortPath } from "../src/application/settings-form.js";
import type { GroupId } from "../src/application/settings-groups.js";
import {
	SETTINGS_LINKS,
	type SettingsModel,
	SettingsView,
} from "../src/application/settings-view.js";

// The read-only Settings screen (ADR-081) rendered to HTML on Node.

const none = () => {};
const html = (model: SettingsModel, group: GroupId = "models") =>
	renderToStaticMarkup(
		createElement(SettingsView, {
			model,
			actions: {
				onApply: none,
				onCommand: none,
				onOpen: none,
				onRefresh: none,
				onScope: none,
				onSaveAll: none,
			},
			choice: { group, onGroup: none },
		}),
	);
// The screen shows one group at a time (ADR-095): this renders it once for each.
const GROUP_IDS: readonly GroupId[] = [
	"models",
	"limits",
	"privacy",
	"tools",
	"teams",
	"look",
	"other",
];
const everyGroup = (render: (group: GroupId) => string) =>
	GROUP_IDS.map(render).join("");

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
		const out = html(LOADED, "models");
		const gateway = out.slice(out.indexOf('aria-label="gateway"'));
		expect(gateway).toContain("models: both");
		expect(gateway).toContain("models: free");
		expect(gateway).toContain('title="/g/settings.yaml">/g/settings.yaml<');
		// A folder's file is named from .mete on, whole in the tooltip; the global file stays whole.
		expect(gateway).toContain(
			'title="/w/.mete/gateway.yaml">.mete/gateway.yaml<',
		);
		expect(out).toContain("max-width:760px");
		// The MCP section sits in the tools group.
		const tools = html(LOADED, "tools");
		const mcp = tools.slice(tools.indexOf('aria-label="mcp"'));
		expect(out).not.toContain('aria-label="mcp"');
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
		expect(html({ kind: "loading" })).toContain("Asking the METE daemon…");
		// Each link sits in the group it belongs to, and every link is in one.
		const where: Record<string, GroupId> = {
			"mete.key.set": "models",
			"mete.team.edit": "teams",
			"mete.team.new": "teams",
			"preferences:open": "look",
			"workbench.action.configureLanguage": "look",
		};
		for (const [id, label] of SETTINGS_LINKS) {
			expect(html(LOADED, where[id])).toContain(`>${label()}<`);
			expect(html(LOADED, "limits")).not.toContain(`>${label()}<`);
		}
		expect(SETTINGS_LINKS.map(([id]) => id)).toContain(SET_KEY_COMMAND.id);
		expect(Object.keys(where).sort()).toEqual(
			SETTINGS_LINKS.map(([id]) => id).sort(),
		);
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
	const gatewayForm = (state: Partial<FormState> = {}) => ({
		state: {
			target: "workspace" as Target,
			file: "/w/.mete/gateway.yaml",
			values: { models: "both", dailySpendUsd: undefined },
			defaults: { models: "free", dailySpendUsd: 1 },
			busy: false,
			dirty: false,
			...state,
		},
		actions: { onField: none, onTarget: none, onSave: none, onClear: none },
	});
	const withForms = (
		model: SettingsModel,
		group: GroupId = "models",
		state?: Partial<FormState>,
	) =>
		renderToStaticMarkup(
			createElement(SettingsView, {
				model,
				actions: {
					onApply: none,
					onCommand: none,
					onOpen: none,
					onRefresh: none,
					onScope: none,
					onSaveAll: none,
				},
				forms: { gateway: gatewayForm(state) },
				choice: { group, onGroup: none },
			}),
		);

	it("always shows the gateway, policy and privacy sections, and a form where it has one", () => {
		const out = everyGroup((g) => withForms(LOADED, g));
		for (const name of ["gateway", "policy", "privacy"])
			expect(out).toContain(`aria-label="${name}"`);
		const policy = withForms(LOADED, "limits");
		expect(policy).toContain("No file sets this section; its defaults apply.");
		const gateway = withForms(LOADED, "models");
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
		// A form has no Save of its own: the bar at the bottom saves them all.
		expect(gateway).not.toMatch(/>Save<\/button>/);
	});

	it("leaves the target to the switch at the top, which is off for All folders without a global file", () => {
		const out = withForms(LOADED);
		expect(out).not.toContain("Save for every folder");
		const switchOf = (page: string) =>
			page.slice(page.indexOf("<fieldset"), page.indexOf("</fieldset>"));
		const folder = switchOf(out);
		expect(folder).toContain("<legend");
		expect(folder).toMatch(/aria-pressed="true">This folder</);
		expect(folder).toMatch(/disabled="" aria-pressed="false">All folders</);
		const withGlobal = {
			kind: "settings",
			settings: { ...LOADED.settings, globalFile: "/g/settings.yaml" },
		} as SettingsModel;
		const global = switchOf(
			withForms(withGlobal, "models", { target: "global" }),
		);
		expect(global).toMatch(/aria-pressed="true">All folders</);
		expect(global).not.toContain("disabled");
		// No forms to switch (the daemon has not answered): no switch.
		expect(html(LOADED)).not.toContain("All folders");
	});

	const only = (layers: object): SettingsModel => ({
		kind: "settings",
		settings: {
			...LOADED.settings,
			sections: [{ name: "gateway", merged: {}, ...layers }],
		},
	});

	it("says where a form's value comes from: this folder's file with Reset, else the global file, else nothing", () => {
		const out = withForms(LOADED);
		expect(out).toContain("Changed for this folder");
		expect(out).toMatch(
			/title="Removes[^"]*\/w\/\.mete\/gateway\.yaml[^"]*">Reset</,
		);
		const global = withForms(
			only({ global: { file: "/g/s.yaml", value: { models: "free" } } }),
		);
		expect(global).toContain("From all folders&#x27; file");
		expect(global).not.toContain(">Reset<");
		// A folder file that sets only keys the form has no field for says nothing.
		const unrelated = withForms(
			only({
				workspace: { file: "/w/.mete/gateway.yaml", value: { other: 1 } },
			}),
		);
		expect(unrelated).not.toContain("Changed for this folder");
		expect(unrelated).not.toContain("From all folders");
	});

	// The save bar (ADR-095), over three forms that differ in what the user did.
	const bar = (states: Record<string, Partial<FormState>>) => {
		const page = renderToStaticMarkup(
			createElement(SettingsView, {
				model: LOADED,
				actions: {
					onApply: none,
					onCommand: none,
					onOpen: none,
					onRefresh: none,
					onScope: none,
					onSaveAll: none,
				},
				forms: Object.fromEntries(
					Object.entries(states).map(([name, s]) => [
						name,
						{ ...gatewayForm(s), actions: gatewayForm().actions },
					]),
				),
			}),
		);
		return page.slice(page.indexOf('aria-label="Save changes'));
	};

	it("says nothing is changed and keeps Save changes off, until a form is changed", () => {
		const idle = bar({ gateway: {}, policy: {} });
		expect(idle).toContain("No unsaved changes");
		expect(idle).toMatch(/disabled="">Save changes</);
		const changed = bar({ gateway: { dirty: true }, policy: { dirty: true } });
		expect(changed).toContain("Unsaved changes: gateway, policy");
		expect(changed).not.toMatch(/disabled="">Save changes</);
		expect(changed).toMatch(/>Save changes</);
	});

	it("holds Save changes while a form saves, and names the file of a form that has a problem", () => {
		expect(bar({ gateway: { dirty: true, busy: true } })).toMatch(
			/disabled="">Save changes</,
		);
		const refused = bar({
			gateway: { dirty: true },
			policy: {
				dirty: true,
				file: "/w/.mete/policy.yaml",
				note: { kind: "refused", text: "Not saved: autonomy: bad" },
			},
		});
		expect(refused).toContain("A problem with .mete/policy.yaml");
		expect(refused).not.toContain("A problem with .mete/gateway.yaml");
		expect(bar({ gateway: { dirty: true } })).not.toContain("A problem with");
	});

	it("holds Reset while the form saves", () => {
		expect(withForms(LOADED, "models", { busy: true })).toMatch(
			/<button type="button" class="mete-button quiet" disabled=""[^>]*>Reset</,
		);
		expect(withForms(LOADED)).not.toMatch(/disabled=""[^>]*>Reset</);
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
					onScope: none,
					onSaveAll: none,
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
		test?: EndpointTestState,
	) =>
		renderToStaticMarkup(
			createElement(SettingsView, {
				model: LOADED,
				actions: {
					onApply: none,
					onCommand: none,
					onOpen: none,
					onRefresh: none,
					onScope: none,
					onSaveAll: none,
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
					...(test === undefined
						? {}
						: {
								tests: {
									stateOf: () => test,
									onList: none,
									onPick: none,
									onProbe: none,
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

	// An endpoint's Test.
	const listed = (picked: string[], testing: boolean): EndpointTestState => ({
		kind: "listed",
		models: ["lab-7b", "lab-70b"],
		picked,
		testing,
		results: [{ modelId: "lab-7b", ok: true, ms: 840 }],
	});

	it("says when METE has not loaded the endpoint", () => {
		expect(
			withEndpoints("global", undefined, false, { kind: "not_loaded" }),
		).toContain(
			"METE has not loaded custom:my-lab: save it, set its API key and press Apply now.",
		);
	});

	it("tests only picked models, says so while it runs, and shows each result", () => {
		const none = withEndpoints("global", undefined, false, listed([], false));
		expect(none).toContain(
			'<button type="button" class="mete-button" disabled="">Test</button>',
		);
		expect(none).toContain("ok, 840 ms");
		const ready = withEndpoints(
			"global",
			undefined,
			false,
			listed(["lab-7b"], false),
		);
		expect(ready).toContain(
			'<button type="button" class="mete-button">Test</button>',
		);
		const running = withEndpoints(
			"global",
			undefined,
			false,
			listed(["lab-7b"], true),
		);
		expect(running).toContain(
			'<button type="button" class="mete-button" disabled="">Testing…</button>',
		);
	});
});

describe("the groups list (ADR-095)", () => {
	const OTHER: SettingsModel = {
		kind: "settings",
		settings: {
			...LOADED.settings,
			sections: [
				...LOADED.settings.sections,
				{
					name: "foo",
					merged: { a: 1 },
					global: { file: "/g/s.yaml", value: { a: 1 } },
				},
			],
		},
	};

	it("lists the groups with what each holds, presses the chosen one, and dots the one set for this folder only", () => {
		const out = html(LOADED, "privacy");
		for (const text of [
			"Models and keys",
			"What the team may do alone",
			"Privacy",
			"Tools and web search",
			"Teams",
			"Look and language",
			"Providers, endpoints and which models METE may use",
		])
			expect(out).toContain(text);
		expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
		expect(out).toMatch(/aria-pressed="true"><strong>Privacy/);
		// LOADED sets gateway and mcp in this folder's files: their groups carry the dot, the others not.
		expect(out.match(/role="img"/g)).toHaveLength(2);
		expect(out).not.toContain("Other files");
	});

	it("shows a section no group holds under Other files, and leaves that group out otherwise", () => {
		expect(html(OTHER, "models")).toContain("Other files");
		const other = html(OTHER, "other");
		expect(other).toContain('aria-label="foo"');
		expect(other).toContain("a: 1");
		expect(html(OTHER, "tools")).not.toContain('aria-label="foo"');
	});

	it("shows only the chosen group's sections beside the list", () => {
		const out = html(LOADED, "limits");
		expect(out).toContain('aria-label="policy"');
		expect(out).not.toContain('aria-label="gateway"');
		expect(out).not.toContain('aria-label="mcp"');
		expect(out).toContain("<h3");
	});
});
