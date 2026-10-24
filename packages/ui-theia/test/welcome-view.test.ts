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
			actions: { onLanguage: none, onKeyPage: none, onStart: none },
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
		const keys = out.slice(
			out.indexOf('aria-label="2. Model provider keys"'),
			out.indexOf('aria-label="3. Privacy"'),
		);
		expect(keys).toContain("<strong>nvidia</strong>");
		expect(keys).toContain('title="https://nvidia.example/keys">Get a key<');
		expect(keys).toMatch(/<input id="mete-welcome-nvidia"[^>]*type="password"/);
		expect(keys).not.toContain("tavily");
		const search = out.slice(out.indexOf('aria-label="4. Web search"'));
		expect(search).toContain("<strong>tavily</strong>");
		expect(search).toContain("Exa MCP searches the web without a key");
	});

	it("starts a run only once a model provider has a key", () => {
		const waiting = html({ kind: "keys", keys: [provider("nvidia", false)] });
		expect(waiting).toContain(
			'<button type="button" class="mete-button" disabled="">Start a run</button>',
		);
		expect(waiting).toContain("Set a model provider&#x27;s key first.");
		const ready = html({ kind: "keys", keys: [provider("nvidia", true)] });
		expect(ready).toContain(
			'<button type="button" class="mete-button">Start a run</button>',
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
			actions: { onField: none, onTarget: none, onSave: none },
			canSaveGlobally: true,
		});
		expect(form).toContain("Allow providers that may train on prompts");
		expect(form).toContain("Saves to /g/settings.yaml");
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
