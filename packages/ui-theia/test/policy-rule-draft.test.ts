import { PolicySchema } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
	defaultsOf,
	draftOf,
	savedText,
} from "../src/application/section-draft.js";

describe("structured policy drafts", () => {
	it("reads only explicit rules and preserves inherited versus empty values", () => {
		const result = draftOf(
			"always_ask: []\noverrides: {}\n",
			"policy",
			"workspace",
		);
		expect(result.ok && result.value).toMatchObject({
			always_ask: [],
			overrides: {},
			never_allow: undefined,
			"shell.allow": undefined,
			"shell.always": undefined,
		});
		expect(defaultsOf("policy").always_ask).toEqual(
			PolicySchema.parse({}).always_ask,
		);
	});

	it("writes edited rule fields without freezing defaults or dropping other fields/comments", () => {
		const before =
			"# user policy\nautonomy: 2\nshell:\n  always: [git status]\nbudget:\n  max_hours: 3\n";
		const result = savedText(before, "policy", "workspace", {
			always_ask: ["git.push", "fs.delete"],
			"shell.allow": ["npm test", "git diff *"],
			never_allow: [{ action: "fs.write", path: "secrets/**" }],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.error);
		expect(result.value).toContain("# user policy");
		expect(parse(result.value)).toEqual({
			autonomy: 2,
			always_ask: ["git.push", "fs.delete"],
			shell: { always: ["git status"], allow: ["npm test", "git diff *"] },
			budget: { max_hours: 3 },
			never_allow: [{ action: "fs.write", path: "secrets/**" }],
		});
	});

	it("clears only a chosen rule field while explicit empty lists remain saved", () => {
		const result = savedText(
			"shell:\n  allow: [ls]\n  always: [git status]\n",
			"policy",
			"workspace",
			{
				"shell.allow": undefined,
				always_ask: [],
			},
		);
		expect(result.ok && parse(result.value)).toEqual({
			shell: { always: ["git status"] },
			always_ask: [],
		});
	});

	it("preserves unrelated global sections when editing a rule", () => {
		const result = savedText(
			"privacy:\n  allowTraining: false\npolicy:\n  autonomy: 1\n",
			"policy",
			"global",
			{
				overrides: { "shell.exec@1": 0 },
			},
		);
		expect(result.ok && parse(result.value)).toEqual({
			privacy: { allowTraining: false },
			policy: { autonomy: 1, overrides: { "shell.exec@1": 0 } },
		});
	});

	it("refuses invalid persisted rule shapes rather than displaying an empty success", () => {
		for (const text of [
			"always_ask: [made.up]\n",
			"never_allow: [{action: git.push, path: '**'}]\n",
			"overrides: {not-a-capability: 1}\n",
			"shell:\n  allow: [git status, null]\n",
		])
			expect(draftOf(text, "policy", "workspace").ok).toBe(false);
	});

	it("keeps the existing full-policy cross-field restriction on save", () => {
		expect(
			savedText("autonomy: 1\n", "policy", "workspace", {
				overrides: { "shell.exec@1": 3 },
			}).ok,
		).toBe(false);
	});

	it("does not turn a structured value in a scalar setting into a reset", () => {
		expect(
			savedText("autonomy: 1\n", "policy", "workspace", {
				autonomy: [],
			}).ok,
		).toBe(false);
	});
});
