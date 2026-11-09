import { describe, expect, it } from "vitest";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import { setPolicyYamlValue } from "../src/application/policy-yaml-values.js";
import {
	type Draft,
	savedText,
	type Target,
} from "../src/application/section-draft.js";

const saved = (text: string, changes: Draft, target: Target = "workspace") => {
	const result = savedText(text, "policy", target, changes);
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(result.error);
	return parseDocument(result.value);
};
const scalar = (
	doc: ReturnType<typeof parseDocument>,
	at: readonly (string | number)[],
) => {
	const node = doc.getIn(at, true);
	if (!isScalar(node)) throw new Error("Missing scalar fixture");
	return node;
};

describe("structured policy YAML retention (UX-R2-YAML)", () => {
	it("accepts primitive string keys created by earlier changes in the same save", () => {
		expect(
			saved("autonomy: 2\n", { always_ask: [], never_allow: [] }).toJS(),
		).toEqual({
			autonomy: 2,
			always_ask: [],
			never_allow: [],
		});
		expect(
			saved("", { autonomy: 2, "budget.max_hours": 3, always_ask: [] }).toJS(),
		).toEqual({
			autonomy: 2,
			budget: { max_hours: 3 },
			always_ask: [],
		});
		expect(
			saved(
				"privacy: { allowTraining: false }\n",
				{
					autonomy: 2,
					always_ask: [],
					never_allow: [],
					overrides: {},
				},
				"global",
			).toJS(),
		).toEqual({
			privacy: { allowTraining: false },
			policy: { autonomy: 2, always_ask: [], never_allow: [], overrides: {} },
		});
	});

	it("keeps changed scalar metadata, untouched override comments, document comments and global sections", () => {
		const doc = saved(
			`# document note
privacy:
  allowTraining: false # privacy note
policy:
  autonomy: 3
  overrides: # override collection
    # write key note
    "fs.write@1": 0x1 # write level note
    "shell.exec@1": 2 # shell level note
# document tail
`,
			{ overrides: { "fs.write@1": 2, "shell.exec@1": 2 } },
			"global",
		);
		expect(doc.toJS()).toEqual({
			privacy: { allowTraining: false },
			policy: {
				autonomy: 3,
				overrides: { "fs.write@1": 2, "shell.exec@1": 2 },
			},
		});
		const write = scalar(doc, ["policy", "overrides", "fs.write@1"]);
		expect(write.value).toBe(2);
		expect(write.format).toBe("HEX");
		expect(write.comment).toContain("write level note");
		expect(
			scalar(doc, ["policy", "overrides", "shell.exec@1"]).comment,
		).toContain("shell level note");
		for (const text of [
			"document note",
			"privacy note",
			"override collection",
			"write key note",
			"document tail",
		])
			expect(doc.toString()).toContain(text);
		const next = saved(
			doc.toString(),
			{ overrides: { "shell.exec@1": 2, "fs.read@1": 0 } },
			"global",
		);
		expect(next.getIn(["policy", "overrides", "fs.write@1"])).toBeUndefined();
		expect(next.getIn(["policy", "overrides", "fs.read@1"])).toBe(0);
		expect(
			scalar(next, ["policy", "overrides", "shell.exec@1"]).comment,
		).toContain("shell level note");
	});

	it("removes one action without moving its comment onto a survivor", () => {
		const doc = saved(
			`always_ask: # list note
  - git.push # removed action
  - fs.delete # survivor
`,
			{ always_ask: ["fs.delete"] },
		);
		expect(doc.toJS()).toEqual({ always_ask: ["fs.delete"] });
		expect(scalar(doc, ["always_ask", 0]).comment).toContain("survivor");
		expect(doc.toString()).toContain("list note");
		expect(doc.toString()).not.toContain("removed action");
	});

	it("retains nested rule nodes by value and duplicate occurrence while adding and reordering rules", () => {
		const rule = { path: "secrets/**", action: "fs.write" as const };
		const command = { action: "shell.exec" as const, command: "blocked *" };
		const values = [
			command,
			rule,
			{ action: "shell.exec" as const, command: "new *" },
			rule,
			rule,
		];
		const doc = saved(
			`never_allow:
  - action: fs.write # first action
    path: secrets/** # first path
  - action: shell.exec # command action
    command: blocked * # command note
  - path: secrets/** # second path
    action: fs.write # second action
`,
			{ never_allow: values },
		);
		expect(doc.toJS()).toEqual({ never_allow: values });
		expect(scalar(doc, ["never_allow", 0, "command"]).comment).toContain(
			"command note",
		);
		expect(scalar(doc, ["never_allow", 1, "action"]).comment).toContain(
			"first action",
		);
		expect(scalar(doc, ["never_allow", 1, "path"]).comment).toContain(
			"first path",
		);
		expect(scalar(doc, ["never_allow", 3, "path"]).comment).toContain(
			"second path",
		);
		expect(scalar(doc, ["never_allow", 3, "action"]).comment).toContain(
			"second action",
		);
		expect(scalar(doc, ["never_allow", 2, "command"]).comment).toBeUndefined();
		expect(scalar(doc, ["never_allow", 4, "path"]).comment).toBeUndefined();
		expect(Object.isFrozen(values)).toBe(false);
	});

	it("keeps explicit empty collections and leaves undefined clearing on the existing path", () => {
		const doc = saved(
			"always_ask: [git.push] # actions\noverrides: { 'fs.write@1': 1 } # levels\n",
			{
				always_ask: [],
				overrides: {},
			},
		);
		expect(doc.toJS()).toEqual({ always_ask: [], overrides: {} });
		expect(isSeq(doc.get("always_ask", true))).toBe(true);
		expect(isMap(doc.get("overrides", true))).toBe(true);
		expect(doc.toString()).toContain("actions");
		expect(doc.toString()).toContain("levels");
		expect(saved(doc.toString(), { always_ask: undefined }).toJS()).toEqual({
			overrides: {},
		});
		expect(
			saved("", { "shell.allow": ["git status", "git status"] }).toJS(),
		).toEqual({
			shell: { allow: ["git status", "git status"] },
		});
	});

	it.each([
		"always_ask: &rules [git.push]\n",
		"rules: &rules [git.push]\nalways_ask: *rules\n",
		"always_ask: !!seq [git.push]\n",
		"always_ask: [git.push, git.push]\n",
		"always_ask: [fs.delete, null]\n",
	])(
		"refuses unsafe or ambiguous nodes without mutating the document: %s",
		(text) => {
			const doc = parseDocument(text);
			const before = doc.toString();
			const result = setPolicyYamlValue(doc, ["always_ask"], ["git.push"]);
			expect(result.ok).toBe(false);
			expect(doc.toString()).toBe(before);
			expect(
				savedText(text, "policy", "workspace", { always_ask: ["git.push"] }).ok,
			).toBe(false);
		},
	);

	it("refuses ambiguous commented replacements and invalid parents as Results", () => {
		for (const [text, at, value] of [
			[
				"shell:\n  allow:\n    - old command # belongs to old\n",
				["shell", "allow"],
				["new command"],
			],
			["shell: 7\n", ["shell", "allow"], ["git status"]],
			["policy: &p { always_ask: [git.push] }\n", ["policy", "always_ask"], []],
		] as const) {
			const doc = parseDocument(text);
			const before = doc.toString();
			expect(setPolicyYamlValue(doc, at, value).ok).toBe(false);
			expect(doc.toString()).toBe(before);
		}
	});

	it("refuses duplicate map keys even when the caller disabled parser uniqueness checks", () => {
		const doc = parseDocument(
			"overrides:\n  fs.write@1: 1 # first\n  fs.write@1: 2 # second\n",
			{
				uniqueKeys: false,
			},
		);
		const before = doc.toString();
		expect(setPolicyYamlValue(doc, ["overrides"], { "fs.write@1": 0 }).ok).toBe(
			false,
		);
		expect(doc.toString()).toBe(before);
	});
});
