import { describe, expect, it } from "vitest";
import {
	defaultsOf,
	draftOf,
	hasKeys,
	layerOf,
	savedText,
} from "../src/application/section-draft.js";

// The Settings forms' files (ADR-082): edited in place, comments and other keys kept, only changed
// keys written, and nothing the section's schema refuses.

describe("a section's file as a form edits it", () => {
	it("reads only the keys the file sets, from a folder file or the global section", () => {
		const policy = "# mine\nautonomy: 3\nshell:\n  allow: [ls]\n";
		expect(draftOf(policy, "policy", "workspace")).toEqual({
			ok: true,
			value: {
				autonomy: 3,
				"budget.cloud_requests_per_run": undefined,
				"budget.max_hours": undefined,
			},
		});
		const global =
			"gateway:\n  models: both\nprivacy:\n  allowTraining: true\n";
		expect(draftOf(global, "gateway", "global")).toEqual({
			ok: true,
			value: { models: "both", dailySpendUsd: undefined },
		});
		expect(draftOf(undefined, "privacy", "workspace")).toEqual({
			ok: true,
			value: { allowTraining: undefined },
		});
	});

	it("takes the placeholders from the schema's defaults", () => {
		expect(defaultsOf("gateway")).toEqual({ models: "free", dailySpendUsd: 1 });
		expect(defaultsOf("privacy")).toEqual({ allowTraining: false });
		expect(defaultsOf("policy").autonomy).toBe(2);
	});

	it("writes only what changed, keeping comments and other keys, and removes a cleared key", () => {
		const policy = "# mine\nautonomy: 3\nshell:\n  allow: [ls]\n";
		const r = savedText(policy, "policy", "workspace", {
			autonomy: 1,
			"budget.max_hours": 2,
		});
		if (!r.ok) throw new Error(r.error);
		expect(r.value).toContain("# mine");
		expect(r.value).toContain("autonomy: 1");
		expect(r.value).toContain("allow: [ ls ]");
		expect(r.value).toContain("max_hours: 2");
		expect(r.value).not.toContain("cloud_requests_per_run");
		const cleared = savedText(r.value, "policy", "workspace", {
			"budget.max_hours": undefined,
		});
		expect(cleared.ok && cleared.value).not.toContain("max_hours");
	});

	it("writes under the section key of the global file, leaving the other sections", () => {
		const global = "privacy:\n  allowTraining: true\n";
		const r = savedText(global, "gateway", "global", { models: "both" });
		if (!r.ok) throw new Error(r.error);
		expect(r.value).toBe(
			"privacy:\n  allowTraining: true\ngateway:\n  models: both\n",
		);
	});

	it("writes nothing for a missing file the form did not change, never a null section", () => {
		expect(savedText(undefined, "policy", "workspace", {})).toEqual({
			ok: true,
			value: "",
		});
	});

	it("refuses what the schema refuses, naming where", () => {
		expect(
			savedText(undefined, "gateway", "global", { dailySpendUsd: -1 }),
		).toEqual({
			ok: false,
			error: "gateway.dailySpendUsd: Too small: expected number to be >0",
		});
		const unknown = savedText(
			"models: free\nextra: 1\n",
			"gateway",
			"workspace",
			{
				models: "paid",
			},
		);
		expect(unknown.ok).toBe(false);
	});
});

describe("where a form's value comes from", () => {
	const layers = (workspace?: unknown, global?: unknown) => ({
		...(workspace === undefined ? {} : { workspace: { value: workspace } }),
		...(global === undefined ? {} : { global: { value: global } }),
	});

	it("names this folder's file when it sets a field of the form, else the global file, else nothing", () => {
		expect(
			layerOf("gateway", layers({ models: "free" }, { models: "both" })),
		).toBe("workspace");
		expect(layerOf("gateway", layers(undefined, { models: "both" }))).toBe(
			"global",
		);
		expect(layerOf("gateway", layers())).toBeUndefined();
	});

	it("looks at the form's own fields only, and reads an empty file as nothing set", () => {
		// policy.yaml may hold keys the form has no field for, such as rules.
		expect(
			layerOf("policy", layers({ shell: { allow: ["ls"] } })),
		).toBeUndefined();
		expect(layerOf("policy", layers({ budget: { max_hours: 2 } }))).toBe(
			"workspace",
		);
		expect(
			layerOf("gateway", {
				workspace: { value: undefined },
				global: { value: { models: "paid" } },
			}),
		).toBe("global");
	});
});

describe("clearing a field (ADR-095 Reset)", () => {
	it("takes the maps a removed key leaves empty with it, and writes nothing for a file left empty", () => {
		const cleared = (
			text: string,
			section: "policy" | "gateway",
			target: "workspace" | "global",
		) =>
			savedText(text, section, target, {
				"budget.max_hours": undefined,
				models: undefined,
			});
		expect(
			cleared("budget:\n  max_hours: 2\nautonomy: 1\n", "policy", "workspace"),
		).toEqual({
			ok: true,
			value: "autonomy: 1\n",
		});
		expect(cleared("budget:\n  max_hours: 2\n", "policy", "workspace")).toEqual(
			{
				ok: true,
				value: "",
			},
		);
		// In the global file the section key goes too, and the other sections stay.
		expect(
			cleared(
				"gateway:\n  models: free\nprivacy:\n  allowTraining: true\n",
				"gateway",
				"global",
			),
		).toEqual({ ok: true, value: "privacy:\n  allowTraining: true\n" });
	});
});

describe("whether a file sets any key", () => {
	it("is no for a missing, empty or comment-only file, and yes for any key", () => {
		expect(hasKeys(undefined)).toBe(false);
		expect(hasKeys("")).toBe(false);
		expect(hasKeys("# notes only\n")).toBe(false);
		expect(hasKeys("models: free\n")).toBe(true);
	});
});
