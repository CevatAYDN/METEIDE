import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateDirs } from "../../src/infrastructure/template-store.js";
import { engineHarness, reply } from "../helpers/engine.js";

// Attempts of distinct families (ADR-162): a later attempt avoids the families the earlier ones ran
// on and sends no pin, which the gateway would put ahead of avoidFamilies.
const BEST = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: best, name: Best, version: 1.0.0 }
pattern: single
roles:
  - { id: dev, name: Dev, goal: Build, tier: coder, capabilities: [] }
tasks:
  - { id: build, role: dev, title: Build, approval: human, guardrail: { schema: research-report@1, max_retries: 0 }, attempts: { n: 2, distinct_families: true, judge_tier: reasoning } }
`;

const REPORT = JSON.stringify({
	title: "T",
	summary: "S",
	findings: [{ claim: "C", sourceIds: ["s1"] }],
	sources: [{ id: "s1", url: "https://example.com", title: "E" }],
});
const passesOn = (family: string) =>
	reply(`\`\`\`json\n${REPORT}\n\`\`\``, [], family, family);

let root: string;
let templates: TemplateDirs;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mete-families-"));
	templates = { builtIn: join(root, "templates"), workspace: root };
	await mkdir(templates.builtIn);
	await mkdir(join(root, ".mete"));
	await writeFile(join(templates.builtIn, "best.yaml"), BEST);
	await writeFile(join(root, ".mete", "pins.yaml"), "best:\n  dev: pp/pm\n");
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("attempts of distinct families (ADR-162)", () => {
	it("pins only the first attempt and has a later one, and its revision, avoid the earlier families", async () => {
		const h = engineHarness({
			scripts: [reply("notes", [], "m1", "llama"), passesOn("qwen")],
			templates,
		});
		const r = await h.engine.start({ goal: "a page", templateId: "best" });
		if (!r.ok) throw new Error(r.error.message);
		const settled = () =>
			vi.waitFor(() =>
				expect(h.engine.status(r.value.runId)).toMatchObject({
					value: [{ status: "paused" }],
				}),
			);
		await settled();
		const revise = { decision: "revise", feedback: "shorter" } as const;
		expect((await h.engine.approve(r.value.runId, revise)).ok).toBe(true);
		await vi.waitFor(() => expect(h.requests).toHaveLength(3));
		const [first, second, revision] = h.requests;
		expect(first?.prefer).toEqual({ providerId: "pp", modelId: "pm" });
		expect(first?.avoidFamilies).toBeUndefined();
		expect(second?.prefer).toBeUndefined();
		expect(second?.avoidFamilies).toEqual(["llama"]);
		expect(revision?.prefer).toBeUndefined();
		expect(revision?.avoidFamilies).toEqual(["llama"]);
	});
});
