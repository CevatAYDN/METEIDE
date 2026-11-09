import { createHash } from "node:crypto";
import type { SkillSourceAdapter, SkillSourceSnapshot } from "@mete/contracts";
import { type SkillSourceHarness, skillSourceContract } from "@mete/testing";
import { expect } from "vitest";
import { createSkillSourceModule } from "../src/index.js";
import { toolContext } from "./helpers/context.js";
import { tempWorkspace } from "./infrastructure/workspace.js";

const text =
	"\ufeff---\r\nname: contract-source\r\ndescription: Exact native fixture\r\n---\r\nComplete body.\r\n";
const path = "contract-source/SKILL.md";

const open: SkillSourceHarness = async () => {
	const ws = await tempWorkspace();
	const module = createSkillSourceModule(ws);
	const close = async () => {
		try {
			await module.deactivate();
		} finally {
			await ws.close();
		}
	};
	try {
		await ws.put(`.mete/skills/${path}`, text);
		const { ctx, registry } = toolContext("deny");
		expect((await module.activate(ctx)).ok).toBe(true);
		const resolved = registry.resolve<SkillSourceAdapter>("skill.source@1");
		if (!resolved.ok) throw new Error("Expected native source adapter");
		const adapter = resolved.value[0].impl;
		const listed = await adapter.list(new AbortController().signal);
		if (!listed.ok) throw new Error("Expected source inventory");
		expect(listed.value.complete).toBe(true);
		expect(listed.value.sources).toHaveLength(1);
		const source = listed.value.sources[0];
		if (!source) throw new Error("Expected fixture source");
		expect(source).toMatchObject({ scope: "workspace", path });
		const snapshot: SkillSourceSnapshot = {
			source: { sourceId: source.sourceId, scope: "workspace", path },
			text,
			sha256: createHash("sha256")
				.update(Buffer.from(text, "utf8"))
				.digest("hex"),
		};
		return { adapter, sourceId: source.sourceId, snapshot, close };
	} catch (error) {
		await close();
		throw error;
	}
};

skillSourceContract("native source module", open);
