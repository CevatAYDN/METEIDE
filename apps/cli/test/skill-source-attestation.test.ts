import type { SkillSourceAdapter } from "@mete/contracts";
import { afterEach, expect, it } from "vitest";
import { skillAppFixture } from "./skill-app-fixture.js";

let fixture: Awaited<ReturnType<typeof skillAppFixture>> | undefined;
afterEach(async () => fixture?.close());

it("createApp exposes only frozen membership for its exact native source implementation", async () => {
	fixture = await skillAppFixture();
	const app = await fixture.start();
	const resolved = app.registry.resolve<SkillSourceAdapter>("skill.source@1");
	if (!resolved.ok) throw new Error("Native source fixture missing");
	const native = resolved.value[0].impl;
	const view = app.skillSourceAdapters;
	expect(view).toBeDefined();
	if (!view) throw new Error("Source attestation missing");
	expect(Object.isFrozen(view)).toBe(true);
	expect(Object.keys(view)).toEqual(["has"]);
	expect(view.has(native)).toBe(true);
	expect(view.has({ ...native })).toBe(false);
	expect("add" in view).toBe(false);
	expect("delete" in view).toBe(false);
	expect(fixture.fetch).not.toHaveBeenCalled();

	await fixture.stop(app);
	const without = await fixture.start({ without: ["tools-skill-source"] });
	expect(without.registry.has("skill.source@1")).toBe(false);
	expect(without.skillSourceAdapters).toBeDefined();
	expect(Object.isFrozen(without.skillSourceAdapters)).toBe(true);
	expect(without.skillSourceAdapters?.has(native)).toBe(false);
	expect(fixture.fetch).not.toHaveBeenCalled();
});
