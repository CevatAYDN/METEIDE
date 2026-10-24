import { describe, expect, it } from "vitest";
import {
	type EndpointDraft,
	endpointsOf,
	savedEndpointsText,
} from "../src/application/endpoints-draft.js";

// The custom endpoints card's file (ADR-087): `providers.custom` edited in place in the global
// settings.yaml or this folder's .mete/providers.yaml, other keys and comments kept, nothing the
// section's schema refuses.

const lab: EndpointDraft = {
	slug: "my-lab",
	name: "My lab",
	baseUrl: "https://lab.example/v1",
	format: "openai-chat",
	headers: "X-Team: blue",
};

describe("a file's custom endpoints as the card edits them", () => {
	it("reads the list from the global section or the folder file, headers as lines", () => {
		const global =
			"gateway:\n  models: free\nproviders:\n  custom:\n    - slug: my-lab\n      name: My lab\n      baseUrl: https://lab.example/v1\n      format: openai-chat\n      headers:\n        X-Team: blue\n";
		expect(endpointsOf(global, "global")).toEqual({ ok: true, value: [lab] });
		const folder =
			"custom:\n  - slug: x\n    name: X\n    baseUrl: https://x.example\n    format: google-gemini\n";
		expect(endpointsOf(folder, "workspace")).toEqual({
			ok: true,
			value: [
				{
					slug: "x",
					name: "X",
					baseUrl: "https://x.example",
					format: "google-gemini",
					headers: "",
				},
			],
		});
		expect(endpointsOf(undefined, "global")).toEqual({ ok: true, value: [] });
		expect(endpointsOf("a: [", "global").ok).toBe(false);
	});

	it("writes the list under providers, keeping comments and other sections", () => {
		const before = "# mine\ngateway:\n  models: both\n";
		const saved = savedEndpointsText(before, "global", [lab]);
		expect(saved.ok && saved.value).toContain("# mine");
		expect(saved.ok && saved.value).toContain("models: both");
		expect(saved.ok && endpointsOf(saved.value, "global")).toEqual({
			ok: true,
			value: [lab],
		});
	});

	it("writes a folder file at its root, leaves headers out when there are none, and removes an empty list", () => {
		const saved = savedEndpointsText(undefined, "workspace", [
			{ ...lab, headers: "" },
		]);
		expect(saved.ok && saved.value).not.toContain("headers");
		expect(saved.ok && saved.value.startsWith("custom:")).toBe(true);
		const emptied = savedEndpointsText(
			saved.ok ? saved.value : "",
			"workspace",
			[],
		);
		expect(emptied.ok && emptied.value).not.toContain("custom");
		expect(emptied.ok && endpointsOf(emptied.value, "workspace")).toEqual({
			ok: true,
			value: [],
		});
	});

	it("refuses what the schema refuses, and a header line without a colon", () => {
		const twice = savedEndpointsText(undefined, "global", [lab, lab]);
		expect(!twice.ok && twice.error).toBe(
			"providers.custom.1.slug: a slug MUST appear once",
		);
		const folder = savedEndpointsText(undefined, "workspace", [lab, lab]);
		expect(!folder.ok && folder.error).toBe(
			"custom.1.slug: a slug MUST appear once",
		);
		const url = savedEndpointsText(undefined, "global", [
			{ ...lab, baseUrl: "lab" },
		]);
		expect(!url.ok && url.error).toMatch(/^providers\.custom\.0\.baseUrl: /);
		const header = savedEndpointsText(undefined, "global", [
			{ ...lab, headers: "X-Team blue" },
		]);
		expect(!header.ok && header.error).toBe(
			'my-lab: a header line needs "Name: value": X-Team blue',
		);
	});
});
