import { expect, it } from "vitest";
import { parse } from "yaml";
import {
	inheritedDefaults,
	savedLayeredText,
} from "../src/application/section-draft.js";

it("validates project overrides against inherited autonomy without writing it into the project", () => {
	const result = savedLayeredText({
		text: "# project\n",
		section: "policy",
		target: "workspace",
		changes: { overrides: { "shell.exec@1": 3 } },
		globalText: "policy:\n  autonomy: 3\n",
	});
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(result.error);
	expect(parse(result.value)).toEqual({ overrides: { "shell.exec@1": 3 } });
	expect(result.value).toContain("# project");
});

it("refuses a project override above the inherited limit and an autonomy that conflicts with inherited overrides", () => {
	for (const [globalText, changes] of [
		["policy:\n  autonomy: 1\n", { overrides: { "shell.exec@1": 2 } }],
		[
			"policy:\n  autonomy: 3\n  overrides: { 'shell.exec@1': 3 }\n",
			{ autonomy: 1 },
		],
	] as const)
		expect(
			savedLayeredText({
				text: undefined,
				section: "policy",
				target: "workspace",
				changes,
				globalText,
			}).ok,
		).toBe(false);
});

it("replaces inherited arrays but merges capability override maps as the configuration contract specifies", () => {
	const globalText =
		"policy:\n  autonomy: 2\n  overrides: { 'shell.exec@1': 2 }\n  always_ask: [git.push]\n";
	const result = savedLayeredText({
		text: undefined,
		section: "policy",
		target: "workspace",
		globalText,
		changes: { overrides: {}, always_ask: [] },
	});
	expect(result.ok && parse(result.value)).toEqual({
		overrides: {},
		always_ask: [],
	});
	expect(
		savedLayeredText({
			text: result.ok ? result.value : undefined,
			section: "policy",
			target: "workspace",
			globalText,
			changes: { autonomy: 1 },
		}).ok,
	).toBe(false);
});

it("shows inherited rule defaults from the actual global section without treating them as local edits", () => {
	const result = inheritedDefaults(
		"policy:\n  always_ask: [git.push]\n  shell:\n    allow: [git diff]\n",
		"policy",
	);
	expect(result.ok && result.value).toMatchObject({
		autonomy: 2,
		always_ask: ["git.push"],
		"shell.allow": ["git diff"],
	});
	expect(inheritedDefaults(undefined, "policy").ok).toBe(true);
	expect(inheritedDefaults("policy: [\n", "policy").ok).toBe(false);
	expect(
		inheritedDefaults("policy:\n  always_ask: [made.up]\n", "policy").ok,
	).toBe(false);
});

it("ignores workspace inheritance when saving the explicitly selected global target", () => {
	const result = savedLayeredText({
		text: "policy:\n  autonomy: 3\nprivacy:\n  allowTraining: false\n",
		section: "policy",
		target: "global",
		globalText: "policy: [\n",
		changes: { overrides: { "shell.exec@1": 3 } },
	});
	expect(result.ok && parse(result.value)).toEqual({
		policy: { autonomy: 3, overrides: { "shell.exec@1": 3 } },
		privacy: { allowTraining: false },
	});
});
