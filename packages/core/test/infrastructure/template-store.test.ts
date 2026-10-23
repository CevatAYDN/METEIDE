import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	loadTemplate,
	readTemplate,
	type TemplateDirs,
} from "../../src/infrastructure/template-store.js";

const yaml = (id: string, name: string) => `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: ${id}, name: ${name}, version: 1.0.0 }
pattern: pipeline
roles:
  - { id: writer, name: Writer, goal: Write, tier: fast, capabilities: [] }
tasks:
  - { id: draft, role: writer, title: Draft }
`;

let root: string;
let dirs: TemplateDirs;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mete-templates-"));
	dirs = { builtIn: join(root, "templates"), workspace: join(root, "ws") };
	await mkdir(dirs.builtIn);
	await mkdir(join(dirs.workspace, ".mete", "teams"), { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

const put = (dir: string, id: string, text: string) =>
	writeFile(join(dir, `${id}.yaml`), text);
const teams = () => join(dirs.workspace, ".mete", "teams");
const code = (r: { ok: boolean; error?: { code: string } }) =>
	r.ok ? "ok" : r.error?.code;

describe("loadTemplate", () => {
	it("loads a built-in template with its defaults", async () => {
		await put(dirs.builtIn, "solo", yaml("solo", "Built in"));
		const r = await loadTemplate(dirs, "solo");
		expect(r.ok && r.value.policies.revision_limit).toBe(3);
	});

	it("takes the workspace template over the built-in one", async () => {
		await put(dirs.builtIn, "solo", yaml("solo", "Built in"));
		await put(teams(), "solo", yaml("solo", "Mine"));
		const r = await loadTemplate(dirs, "solo");
		expect(r.ok && r.value.metadata.name).toBe("Mine");
	});

	it("answers not_found when neither folder has it", async () => {
		expect(code(await loadTemplate(dirs, "solo"))).toBe("not_found");
	});

	it("refuses an id that is not kebab-case before touching a path", async () => {
		expect(code(await loadTemplate(dirs, "../ws/x"))).toBe("bad_input");
	});

	it("rejects a file whose metadata.id is not its name", async () => {
		await put(teams(), "solo", yaml("other", "Mine"));
		const r = await loadTemplate(dirs, "solo");
		expect(r.ok ? [] : r.error).toMatchObject({
			code: "invalid_template",
			issues: ["metadata.id: other does not match the file name solo"],
		});
	});

	it("refuses a guardrail whose artifact type has no schema yet", async () => {
		const text = yaml("solo", "Mine").replace(
			"title: Draft }",
			"title: Draft, guardrail: { schema: lesson@1 } }",
		);
		await put(teams(), "solo", text);
		const r = await loadTemplate(dirs, "solo");
		expect(r.ok ? [] : r.error).toMatchObject({
			issues: ["tasks.0.guardrail.schema: lesson@1 has no schema yet"],
		});
	});

	it("reports broken YAML as invalid_template", async () => {
		await put(teams(), "solo", "roles: [");
		expect(code(await loadTemplate(dirs, "solo"))).toBe("invalid_template");
	});
});

describe("readTemplate", () => {
	it("reads the text loadTemplate would load, the workspace's first, and names its folder", async () => {
		await put(dirs.builtIn, "solo", yaml("solo", "Built in"));
		const built = await readTemplate(dirs, "solo");
		expect(built.ok && built.value).toEqual({
			source: "builtIn",
			text: yaml("solo", "Built in"),
		});
		await put(teams(), "solo", "roles: [");
		const mine = await readTemplate(dirs, "solo");
		expect(mine.ok && mine.value).toEqual({
			source: "workspace",
			text: "roles: [",
		});
	});

	it("answers not_found and bad_input as loadTemplate does", async () => {
		expect(code(await readTemplate(dirs, "solo"))).toBe("not_found");
		expect(code(await readTemplate(dirs, "../ws/x"))).toBe("bad_input");
	});
});
