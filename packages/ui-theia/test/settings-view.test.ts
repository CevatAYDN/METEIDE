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
		const gateway = out.slice(
			out.indexOf('aria-label="Models and daily spend"'),
		);
		// The card's title is in plain words, with the section id beside it (ADR-095).
		expect(gateway).toMatch(
			/<h3[^>]*>Models and daily spend<span[^>]*> · gateway<\/span>/,
		);
		expect(gateway).toContain("models: both");
		expect(gateway).toContain("models: free");
		expect(gateway).toContain('title="/g/settings.yaml">/g/settings.yaml<');
		// A folder's file is named from .mete on, whole in the tooltip; the global file stays whole.
		expect(gateway).toContain(
			'title="/w/.mete/gateway.yaml">.mete/gateway.yaml<',
		);
		// The MCP section sits in the tools group.
		const tools = html(LOADED, "tools");
		const mcp = tools.slice(tools.indexOf('aria-label="MCP servers"'));
		expect(out).not.toContain('aria-label="MCP servers"');
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
		for (const title of [
			"Models and daily spend",
			"Approvals and limits",
			"Training on your prompts",
		])
			expect(out).toContain(`aria-label="${title}"`);
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
			'title="/w/.mete/gateway.yaml"><span aria-hidden="true" class="codicon codicon-file"></span>Saves to .mete/gateway.yaml<',
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

	it("shows the shell form: a choice of shell, and the Git Bash path", () => {
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
				forms: {
					shell: {
						state: {
							target: "workspace",
							file: "/w/.mete/shell.yaml",
							values: {
								windows: "git-bash",
								gitBashPath: "C:/Program Files/Git/bin/bash.exe",
							},
							defaults: { windows: "powershell", gitBashPath: undefined },
							busy: false,
							dirty: false,
						},
						actions: {
							onField: none,
							onTarget: none,
							onSave: none,
							onClear: none,
						},
					},
				},
				choice: { group: "tools", onGroup: none },
			}),
		);
		const card = page.slice(page.indexOf('aria-label="Which shell"'));
		expect(card).toContain(
			'<label for="mete-setting-windows">Windows shell</label>',
		);
		expect(card).toContain(
			'<option value="git-bash" selected="">Git Bash</option>',
		);
		expect(card).toContain(
			'<option value="">Default (Windows PowerShell)</option>',
		);
		expect(card).toContain(
			'<label for="mete-setting-gitBashPath">Git Bash path</label>',
		);
		expect(card).toContain('value="C:/Program Files/Git/bin/bash.exe"');
	});

	it("leaves the target to the switch at the top, which is off for All folders without a global file", () => {
		const out = withForms(LOADED);
		expect(out).not.toContain("Save for every folder");
		const switchOf = (page: string) =>
			page.slice(page.indexOf("<fieldset"), page.indexOf("</fieldset>"));
		const folder = switchOf(out);
		expect(folder).toContain("<legend");
		expect(folder).toMatch(
			/aria-pressed="true"><span[^>]*><\/span>This folder</,
		);
		expect(folder).toMatch(
			/disabled="" aria-pressed="false"><span[^>]*><\/span>All folders</,
		);
		const withGlobal = {
			kind: "settings",
			settings: { ...LOADED.settings, globalFile: "/g/settings.yaml" },
		} as SettingsModel;
		const global = switchOf(
			withForms(withGlobal, "models", { target: "global" }),
		);
		expect(global).toMatch(
			/aria-pressed="true"><span[^>]*><\/span>All folders</,
		);
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
			/title="Removes[^"]*\/w\/\.mete\/gateway\.yaml[^"]*"><span[^>]*><\/span>Reset</,
		);
		// The origin sits in the card's head, above what METE loaded (ADR-128).
		expect(out.indexOf("Changed for this folder")).toBeLessThan(
			out.indexOf("What METE uses:"),
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
	// Save changes, off: its glyph, then its words.
	const OFF = /disabled=""><span[^>]*><\/span>Save changes</;

	it("says nothing is changed and keeps Save changes off, until a form is changed", () => {
		const idle = bar({ gateway: {}, policy: {} });
		expect(idle).toContain("No unsaved changes");
		expect(idle).toMatch(OFF);
		const changed = bar({ gateway: { dirty: true }, policy: { dirty: true } });
		expect(changed).toContain("Unsaved changes: gateway, policy");
		expect(changed).not.toMatch(OFF);
		expect(changed).toMatch(/<\/span>Save changes</);
	});

	it("holds Save changes while a form saves, and names the file of a form that has a problem", () => {
		expect(bar({ gateway: { dirty: true, busy: true } })).toMatch(OFF);
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
			/<button type="button" class="mete-button quiet ghost" disabled=""[^>]*><span[^>]*><\/span>Reset</,
		);
		expect(withForms(LOADED)).not.toMatch(
			/disabled=""[^>]*><span[^>]*><\/span>Reset</,
		);
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

	// The save bar holds it (ADR-128), past Save changes.
	const inBar = (page: string) =>
		page.slice(page.indexOf('aria-label="Save changes'));

	it("is on while no run runs, and off with the reason while one does", () => {
		expect(inBar(withApply(0))).toMatch(
			/<button type="button" class="mete-button quiet"><span[^>]*><\/span>Apply now<\/button>/,
		);
		const busy = inBar(withApply(1));
		expect(busy).toMatch(
			/<button type="button" class="mete-button quiet" disabled=""><span[^>]*><\/span>Apply now<\/button>/,
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
		const card = out.slice(out.indexOf('aria-label="Custom endpoints"'));
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

describe("the bindings card (ADR-096)", () => {
	const withBindings = (
		rows: { capability: string; adapters: string }[],
		state: Partial<{ dirty: boolean; busy: boolean }> = {},
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
				bindings: {
					state: {
						target: "workspace",
						file: "/w/.mete/bindings.yaml",
						rows,
						busy: false,
						dirty: false,
						...state,
					},
					actions: { onRow: none, onAdd: none, onRemove: none },
				},
				choice: { group: "tools", onGroup: none },
			}),
		);

	it("shows a row per capability with its hint, Add and the file it saves to", () => {
		const out = withBindings([
			{ capability: "web.search@1", adapters: "exa-mcp, tavily" },
		]);
		const card = out.slice(out.indexOf('aria-label="Tool adapters"'));
		expect(card).toContain('value="web.search@1"');
		expect(card).toContain('value="exa-mcp, tavily"');
		expect(card).toContain("One row per capability");
		expect(card).toContain("web.search@1 → exa-mcp, tavily");
		expect(card).toContain("Add capability");
		expect(card).toContain(
			'title="/w/.mete/bindings.yaml"><span aria-hidden="true" class="codicon codicon-file"></span>Saves to .mete/bindings.yaml<',
		);
		expect(card).toMatch(/<button[^>]*>Remove<\/button>/);
		// The switch and the bar own the target and the save: the card has neither.
		expect(card).not.toMatch(/>Save<\/button>/);
		expect(card).not.toContain("Save for this folder only");
	});

	it("shows the card also when no file sets the section", () => {
		const out = withBindings([]);
		expect(out).toContain('aria-label="Tool adapters"');
		expect(out).toContain("No file sets this section; its defaults apply.");
		expect(out).not.toContain("mete-binding-0-capability");
	});

	it("is one of the forms the save bar saves", () => {
		const out = withBindings([{ capability: "web.search@1", adapters: "" }], {
			dirty: true,
		});
		expect(out).toContain("Unsaved changes: bindings");
		expect(out).toMatch(/>Save changes</);
	});
});

describe("the MCP servers card (ADR-097)", () => {
	const server = (fields: Record<string, unknown>) => ({
		id: "",
		transport: "",
		runtime: "",
		command: "",
		args: "",
		env: "",
		url: "",
		sha256: "",
		auth: "",
		permissions: [] as string[],
		...fields,
	});
	const withMcp = (
		servers: ReturnType<typeof server>[],
		state: Partial<{ dirty: boolean; busy: boolean }> = {},
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
				mcp: {
					state: {
						target: "workspace",
						file: "/w/.mete/mcp.yaml",
						servers,
						busy: false,
						dirty: false,
						...state,
					},
					actions: {
						onField: none,
						onPermission: none,
						onAdd: none,
						onRemove: none,
					},
				},
				choice: { group: "tools", onGroup: none },
			}),
		);

	it("shows a local server's command, arguments, environment and permissions", () => {
		const out = withMcp([
			server({
				id: "blender",
				transport: "stdio",
				runtime: "python",
				command: "uvx",
				args: "blender-mcp==1.2.0",
				env: "BLENDER_HOST=127.0.0.1",
				permissions: ["fs.read"],
			}),
		]);
		const card = out.slice(out.indexOf('aria-label="MCP servers"'));
		expect(card).toContain('value="blender"');
		expect(card).toContain('<option value="stdio" selected="">');
		expect(card).toContain('<option value="python" selected="">');
		expect(card).toContain('value="uvx"');
		expect(card).toContain("blender-mcp==1.2.0</textarea>");
		expect(card).toContain("BLENDER_HOST=127.0.0.1</textarea>");
		expect(card).toContain(
			'<input id="mete-mcp-0-permissions-fs.read" type="checkbox" checked=""/>',
		);
		expect(card).toContain("Add server");
		expect(card).toContain(
			'title="/w/.mete/mcp.yaml"><span aria-hidden="true" class="codicon codicon-file"></span>Saves to .mete/mcp.yaml<',
		);
		// The download belongs to a binary server only.
		expect(card).not.toContain("SHA-256");
	});

	it("shows a remote server's URL and sign-in, and a binary server's download", () => {
		const remote = withMcp([
			server({
				id: "hf-spaces",
				transport: "streamable-http",
				url: "https://huggingface.co/mcp",
				auth: "oauth",
			}),
		]);
		const card = remote.slice(remote.indexOf('aria-label="MCP servers"'));
		expect(card).toContain('<option value="streamable-http" selected="">');
		expect(card).toContain('value="https://huggingface.co/mcp"');
		expect(card).toContain('<option value="oauth" selected="">');
		expect(card).not.toContain('id="mete-mcp-0-command"');
		expect(card).not.toContain('id="mete-mcp-0-runtime"');
		const binary = withMcp([
			server({
				id: "native",
				transport: "stdio",
				runtime: "binary",
				command: "native-server",
				url: "https://example.test/server.zip",
				sha256: "a".repeat(64),
			}),
		]);
		expect(binary).toContain('id="mete-mcp-0-sha256"');
		expect(binary).toContain('value="https://example.test/server.zip"');
	});

	it("is one of the forms the save bar saves", () => {
		const out = withMcp([server({ id: "blender" })], { dirty: true });
		expect(out).toContain("Unsaved changes: mcp");
		expect(out).toMatch(/>Save changes</);
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
		expect(out).toMatch(
			/aria-pressed="true">(?:(?!<\/button>).)*<strong>Privacy/,
		);
		// LOADED sets gateway and mcp in this folder's files: their groups carry the dot, the others not.
		expect(out.match(/role="img"/g)).toHaveLength(2);
		expect(out).not.toContain("Other files");
	});

	it("shows a section no group holds under Other files, and leaves that group out otherwise", () => {
		expect(html(OTHER, "models")).toContain("Other files");
		const other = html(OTHER, "other");
		// A section METE has no words for keeps its id as its title.
		expect(other).toContain('aria-label="foo"');
		expect(other).toMatch(/<h3[^>]*>foo<\/h3>/);
		expect(other).toContain("a: 1");
		expect(html(OTHER, "tools")).not.toContain('aria-label="foo"');
	});

	it("shows only the chosen group's sections beside the list", () => {
		const out = html(LOADED, "limits");
		expect(out).toContain('aria-label="Approvals and limits"');
		expect(out).not.toContain('aria-label="Models and daily spend"');
		expect(out).not.toContain('aria-label="MCP servers"');
		expect(out).toContain("<h3");
	});
});
