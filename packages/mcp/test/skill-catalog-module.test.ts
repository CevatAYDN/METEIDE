import type { SkillCatalogAdapter } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { createSkillCatalogModule } from "../src/skill-catalog-module.js";
import { setup } from "./helpers/skill-catalog.js";

describe("optional skill catalog module", () => {
	it("attests the registered impl without startup I/O", async () => {
		const { ctx, registry, nativeSources, source } = setup();
		const catalogs = new WeakSet<SkillCatalogAdapter>();
		const onAdapter = vi.fn((impl: SkillCatalogAdapter) => catalogs.add(impl));
		const module = createSkillCatalogModule({ nativeSources, onAdapter });
		expect(module.manifest).toMatchObject({
			id: "skills-catalog",
			class: "optional",
			requires: ["skill.source@1"],
			provides: ["skill.catalog@1"],
			optional: [],
			permissions: [],
		});
		expect(await module.activate(ctx)).toEqual({ ok: true, value: undefined });
		const resolved = registry.resolve<SkillCatalogAdapter>("skill.catalog@1");
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) throw new Error("catalog fixture registration missing");
		expect(onAdapter).toHaveBeenCalledWith(resolved.value[0].impl);
		expect(catalogs.has(resolved.value[0].impl)).toBe(true);
		expect(source.list).not.toHaveBeenCalled();
		expect(source.read).not.toHaveBeenCalled();
		await module.deactivate();
		expect(registry.has("skill.catalog@1")).toBe(false);
	});
});
