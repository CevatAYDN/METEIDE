import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type ChatRequest, ok, type SkillTrustAdapter } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { scriptedProvider } from "./helpers.js";
import { skillAppFixture, skillText } from "./skill-app-fixture.js";

let fixture: Awaited<ReturnType<typeof skillAppFixture>> | undefined;
afterEach(async () => {
	await fixture?.close();
});
const setup = async () => {
	fixture = await skillAppFixture();
	return fixture;
};

describe("optional native skill composition", () => {
	it("discovers workspace/global copies and invalid YAML without inference or fetch", async () => {
		const t = await setup();
		await t.write("workspace", "public", skillText("public"));
		await t.write(
			"workspace",
			"bad",
			"---\nname: bad\nname: bad\n---\nInvalid.\n",
		);
		await t.write("global", "public", skillText("public"));
		const seen: ChatRequest[] = [];
		const app = await t.start({
			provider: scriptedProvider({ script: [], seen }),
		});
		const result = await t.trust(app).status(new AbortController().signal);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("inventory failed");
		expect(result.value.complete).toBe(true);
		expect(result.value.entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					source: expect.objectContaining({
						scope: "workspace",
						path: "public/SKILL.md",
					}),
					status: "unapproved",
				}),
				expect.objectContaining({
					source: expect.objectContaining({
						scope: "global",
						path: "public/SKILL.md",
					}),
					status: "unapproved",
				}),
				expect.objectContaining({
					source: expect.objectContaining({
						scope: "workspace",
						path: "bad/SKILL.md",
					}),
					status: "invalid",
				}),
			]),
		);
		expect(seen).toEqual([]);
		expect(t.fetch).not.toHaveBeenCalled();
	});

	it("registers without scanning or creating skill roots at startup", async () => {
		const t = await setup();
		await mkdir(join(t.repo.workspaceDir, ".mete"), { recursive: true });
		await writeFile(
			join(t.repo.workspaceDir, ".mete", "skills"),
			"not a directory",
		);
		const app = await t.start();
		expect(app.registry.has("skill.source@1")).toBe(true);
		expect(app.registry.has("skill.catalog@1")).toBe(true);
		expect(app.registry.has("skill.trust@1")).toBe(true);
		await expect(stat(join(t.repo.globalDir, "skills"))).rejects.toMatchObject({
			code: "ENOENT",
		});
		expect(
			await t.trust(app).status(new AbortController().signal),
		).toMatchObject({ ok: false });
		expect(t.fetch).not.toHaveBeenCalled();
	});

	it("filters each optional module through the existing without option", async () => {
		const t = await setup();
		for (const [module, capability] of [
			["tools-skill-source", "skill.source@1"],
			["skills-catalog", "skill.catalog@1"],
			["skills-trust", "skill.trust@1"],
		] as const) {
			const app = await t.start({ without: [module] });
			expect(app.registry.has(capability)).toBe(false);
			await t.stop(app);
		}
	});

	it("exposes readonly native implementation attestation rather than trusting labels", async () => {
		const t = await setup();
		const app = await t.start();
		const native = t.trust(app);
		expect(app.skillTrustAdapters.has(native)).toBe(true);
		const foreign: SkillTrustAdapter = {
			...native,
			status: async () => ok({ entries: [], complete: true, diagnostics: [] }),
		};
		expect(app.skillTrustAdapters.has(foreign)).toBe(false);
		expect(Object.keys(app.skillTrustAdapters)).toEqual(["has"]);
	});
});
