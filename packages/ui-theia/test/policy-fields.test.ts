import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { PolicyFields } from "../src/application/policy-fields.js";
import { defaultsOf } from "../src/application/section-draft.js";

const state = {
	target: "workspace" as const,
	file: "/project/.mete/policy.yaml",
	values: {},
	defaults: defaultsOf("policy"),
	inherited: {},
	busy: false,
	dirty: false,
	readValid: true,
};

it("renders existing rule controls with inheritance and no permission evaluation claim", () => {
	const html = renderToStaticMarkup(
		createElement(PolicyFields, { state, onField: vi.fn() }),
	);
	for (const text of [
		"Actions that ask first",
		"Remembered command approvals",
		"Denied paths and commands",
		"Capability approval levels",
	])
		expect(html).toContain(text);
	expect(html).not.toContain("All actions allowed");
});

it("does not infer read validity from dirty values or a cleared error note", () => {
	const html = renderToStaticMarkup(
		createElement(PolicyFields, {
			state: {
				...state,
				readValid: false,
				dirty: true,
				values: { autonomy: 2 },
			},
			onField: vi.fn(),
		}),
	);
	expect(html).toContain("Rules are unavailable");
	expect(html).not.toContain("<select");
});

it("qualifies full-autonomy behavior when lower capability overrides apply", () => {
	const html = renderToStaticMarkup(
		createElement(PolicyFields, {
			state: {
				...state,
				values: { autonomy: 3, overrides: { "shell.exec@1": 1 } },
			},
			onField: vi.fn(),
		}),
	);
	expect(html).toContain(
		"Actions at full autonomy bypass ask-first rules; lower capability overrides still apply.",
	);
});

it("retains an incomplete deny pattern as an editable draft with its validation error", () => {
	const html = renderToStaticMarkup(
		createElement(PolicyFields, {
			state: {
				...state,
				dirty: true,
				values: { never_allow: [{ action: "shell.exec", command: "" }] },
			},
			onField: vi.fn(),
		}),
	);
	expect(html).toContain('value=""');
	expect(html).toContain("A path or command pattern is missing or invalid");
	expect(html).not.toContain("Rules are unavailable");
});

it("does not merge schema-supplied override defaults into a custom empty map", () => {
	const html = renderToStaticMarkup(
		createElement(PolicyFields, {
			state: { ...state, values: { overrides: {} } },
			onField: vi.fn(),
		}),
	);
	expect(html).not.toContain("Level for shell.exec@1");
	const inherited = renderToStaticMarkup(
		createElement(PolicyFields, {
			state: {
				...state,
				values: { overrides: {} },
				inherited: { overrides: { "shell.exec@1": 1 } },
			},
			onField: vi.fn(),
		}),
	);
	expect(inherited).toContain("Level for shell.exec@1");
});
