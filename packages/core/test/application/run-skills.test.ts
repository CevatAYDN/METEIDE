import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	err,
	ok,
	type SkillSelectionAdapter,
	type SkillVersion,
} from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateDirs } from "../../src/infrastructure/template-store.js";
import { engineHarness, reply } from "../helpers/engine.js";

const DUO = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: duo, name: Duo, version: 1.0.0 }
pattern: pipeline
roles:
  - { id: finder, name: Finder, goal: Find facts, tier: reasoning, capabilities: [] }
  - { id: writer, name: Writer, goal: Write, tier: fast, capabilities: [] }
tasks:
  - { id: find, role: finder, title: Find facts }
  - { id: write, role: writer, title: Write it up, context: [find] }
budget: { cloud_requests: 5 }
`;

type H = ReturnType<typeof engineHarness>;
let root: string;
let templates: TemplateDirs;
const open: H[] = [];
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mete-run-skills-"));
	templates = { builtIn: join(root, "templates"), workspace: root };
	await mkdir(templates.builtIn);
	await writeFile(join(templates.builtIn, "duo.yaml"), DUO);
});
afterEach(async () => {
	for (const h of open.splice(0)) {
		await h.stop();
		h.db.close();
	}
	await rm(root, { recursive: true, force: true });
});

const version = (n: number): SkillVersion => ({
	sourceId: n.toString(16).padStart(64, "0"),
	sha256: "b".repeat(64),
	revision: 1,
});
const harness = (check?: SkillSelectionAdapter["check"]) => {
	const h = engineHarness({ scripts: [reply("done")], templates });
	open.push(h);
	const spy = vi.fn<SkillSelectionAdapter["check"]>(
		check ?? (async () => ok(null)),
	);
	h.registry.provide<SkillSelectionAdapter>("skill.selection@1", {
		id: "security",
		trust: "core",
		features: [],
		impl: { check: spy },
	});
	return { h, check: spy };
};

describe("run.skills@1 start", () => {
	it("admits exact template roles and defers team contexts to task attempts", async () => {
		const { h, check } = harness();
		const started = await h.runSkills.start({
			goal: "facts",
			templateId: "duo",
			skills: {
				mode: "manual",
				roles: [
					{ roleId: "finder", selected: [version(1)] },
					{ roleId: "writer", selected: [version(2)] },
				],
			},
		});
		if (!started.ok) throw new Error(started.error.message);
		const context = h.store.load(started.value.runId)?.snapshot.context;
		expect(context?.skillRuntimeVersion).toBe(1);
		expect(context?.skills?.policy.roles.map(({ roleId }) => roleId)).toEqual([
			"finder",
			"writer",
		]);
		expect(context?.skills?.contexts).toEqual([]);
		expect(check.mock.calls.map(([input]) => input)).toEqual([
			{ selected: [version(1)] },
			{ selected: [version(2)] },
		]);
	});

	it("refuses a role the template does not define and creates no run", async () => {
		const { h, check } = harness();
		const refused = await h.runSkills.start({
			goal: "facts",
			templateId: "duo",
			skills: {
				mode: "manual",
				roles: [{ roleId: "ghost", selected: [version(1)] }],
			},
		});
		expect(refused).toMatchObject({ ok: false, error: { code: "bad_input" } });
		expect(h.store.list()).toEqual([]);
		expect(check).not.toHaveBeenCalled();
	});

	it("refuses explicit selections without a decided template", async () => {
		const { h } = harness();
		const refused = await h.runSkills.start({
			goal: "facts",
			skills: {
				mode: "manual",
				roles: [{ roleId: "assistant", selected: [version(1)] }],
			},
		});
		expect(refused).toMatchObject({ ok: false, error: { code: "bad_input" } });
		expect(h.requests).toEqual([]);
		expect(h.store.list()).toEqual([]);
	});

	it("creates no run when any role's preflight refuses", async () => {
		const { h } = harness(async ({ selected }) =>
			selected[0]?.sourceId === version(2).sourceId
				? err({ code: "budget_exceeded" })
				: ok(null),
		);
		const refused = await h.runSkills.start({
			goal: "facts",
			templateId: "duo",
			skills: {
				mode: "manual",
				roles: [
					{ roleId: "finder", selected: [version(1)] },
					{ roleId: "writer", selected: [version(2)] },
				],
			},
		});
		expect(refused).toMatchObject({ ok: false, error: { code: "bad_input" } });
		expect(h.store.list()).toEqual([]);
	});

	it("gives a single agent one assistant context", async () => {
		const { h } = harness();
		const started = await h.runSkills.start({
			goal: "facts",
			templateId: null,
			skills: {
				mode: "manual",
				roles: [{ roleId: "assistant", selected: [version(1)] }],
			},
		});
		if (!started.ok) throw new Error(started.error.message);
		const skills = h.store.load(started.value.runId)?.snapshot.context.skills;
		expect(skills?.contexts).toEqual([
			expect.objectContaining({ roleId: "assistant", snapshots: [] }),
		]);
	});

	it("keeps legacy engine starts free of any S2 marker", async () => {
		const { h } = harness();
		const started = await h.engine.start({ goal: "facts", templateId: null });
		if (!started.ok) throw new Error(started.error.message);
		const context = h.store.load(started.value.runId)?.snapshot.context;
		expect(context?.skillRuntimeVersion).toBeUndefined();
		expect(context?.skills).toBeUndefined();
	});

	it("reports an unknown run as not_found, never as empty evidence", async () => {
		const { h } = harness();
		expect(
			await h.runSkills.read({ runId: "00000000-0000-4000-8000-000000000001" }),
		).toEqual({ ok: false, error: { code: "not_found" } });
	});
});
