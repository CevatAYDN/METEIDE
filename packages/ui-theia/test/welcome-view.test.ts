import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	needsWelcome,
	type WelcomeModel,
	type WelcomePrivacy,
	WelcomeView,
} from "../src/application/welcome-view.js";
import type { ProviderKey } from "../src/domain/provider-keys.js";

// The Welcome screen (ADR-088) rendered to HTML on Node.

const none = () => {};
const provider = (
	id: string,
	set: boolean,
	kind: ProviderKey["kind"] = "model",
): ProviderKey => ({ id, set, kind, keyPage: `https://${id}.example/keys` });

const html = (model: WelcomeModel, privacy?: WelcomePrivacy) =>
	renderToStaticMarkup(
		createElement(WelcomeView, {
			model,
			keys: {
				stateOf: () => ({ key: "", busy: false }),
				onType: none,
				onSet: none,
				activeRuns: 0,
			},
			privacy,
			actions: {
				onLanguage: none,
				onKeyPage: none,
				onStart: none,
				onCheck: none,
			},
		}),
	);

describe("the Welcome screen", () => {
	it("opens by itself until a model provider has a key; a search key does not count", () => {
		expect(needsWelcome([])).toBe(true);
		expect(
			needsWelcome([
				provider("nvidia", false),
				provider("tavily", true, "search"),
			]),
		).toBe(true);
		expect(needsWelcome([provider("nvidia", true)])).toBe(false);
	});

	it("lists model providers under keys and the search provider under web search, each with its key page", () => {
		const out = html({
			kind: "keys",
			keys: [provider("nvidia", false), provider("tavily", false, "search")],
		});
		// Each step's region is named by its heading, the number with the title (ADR-128).
		expect(out).toContain(
			'aria-labelledby="mete-step-2"><div class="mete-welcome-head"><span class="mete-welcome-tile"><span aria-hidden="true" class="codicon codicon-key"></span></span><h3 id="mete-step-2"><span class="mete-welcome-n">2.</span> Model provider keys</h3>',
		);
		const keys = out.slice(
			out.indexOf('aria-labelledby="mete-step-2"'),
			out.indexOf('aria-labelledby="mete-step-3"'),
		);
		expect(keys).toContain("<strong>nvidia</strong>");
		expect(keys).toContain('title="https://nvidia.example/keys">Get a key<');
		expect(keys).toMatch(/<input id="mete-welcome-nvidia"[^>]*type="password"/);
		expect(keys).not.toContain("tavily");
		const search = out.slice(out.indexOf('aria-labelledby="mete-step-4"'));
		expect(search).toContain("<strong>tavily</strong>");
		expect(search).toContain("Exa MCP searches the web without a key");
	});

	it("starts a run only once a model provider has a key", () => {
		const waiting = html({ kind: "keys", keys: [provider("nvidia", false)] });
		expect(waiting).toContain(
			'<button type="button" class="mete-button" disabled=""><span aria-hidden="true" class="codicon codicon-play"></span>Start a run</button>',
		);
		expect(waiting).toContain("Set a model provider&#x27;s key first.");
		const ready = html({ kind: "keys", keys: [provider("nvidia", true)] });
		expect(ready).toContain(
			'<button type="button" class="mete-button"><span aria-hidden="true" class="codicon codicon-play"></span>Start a run</button>',
		);
		expect(ready).toContain("key set");
	});

	it("says training providers are off with no folder open, and shows the privacy form with one", () => {
		const keys: WelcomeModel = { kind: "keys", keys: [] };
		expect(html(keys, { kind: "no_folder" })).toContain(
			"They are off now; open a folder to change this in Settings.",
		);
		const form = html(keys, {
			kind: "form",
			state: {
				target: "global",
				file: "/g/settings.yaml",
				values: { allowTraining: undefined },
				defaults: { allowTraining: false },
				busy: false,
				dirty: false,
			},
			actions: { onField: none, onTarget: none, onSave: none, onClear: none },
			canSaveGlobally: true,
		});
		expect(form).toContain("Allow providers that may train on prompts");
		expect(form).toContain("Saves to /g/settings.yaml");
	});

	it("says how each keyed model provider stands in the open folder, and checks again (ADR-147)", () => {
		const keys: WelcomeModel = {
			kind: "keys",
			keys: [provider("nvidia", true), provider("groq", true)],
		};
		const out = renderToStaticMarkup(
			createElement(WelcomeView, {
				model: keys,
				states: [
					{ id: "nvidia", state: "ready" },
					{ id: "groq", state: "unusable" },
				],
				keys: {
					stateOf: () => ({ key: "", busy: false }),
					onType: none,
					onSet: none,
					activeRuns: 0,
				},
				actions: {
					onLanguage: none,
					onKeyPage: none,
					onStart: none,
					onCheck: none,
				},
			}),
		);
		expect(out).toContain('class="mete-welcome-health good"');
		expect(out).toContain("nvidia: ready");
		expect(out).toContain("groq: none of its models can be used here");
		expect(out).toContain("Check again");
		// No folder, so no states: the rows say only whether a key is set.
		expect(html(keys)).not.toContain("mete-welcome-health");
		expect(html(keys)).not.toContain("Check again");
	});

	it("says why it cannot list the providers", () => {
		const out = html({
			kind: "failed",
			failure: { code: "cli", detail: "keychain locked" },
		});
		expect(out).toContain('role="alert"');
		expect(out).toContain("keychain locked");
		expect(out).not.toContain("Start a run");
	});
});
