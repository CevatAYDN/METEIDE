import { join } from "node:path";
import {
	type FsContextAdapter,
	TOOL_CATALOG,
	type ToolAdapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createToolsFsModule } from "../src/module.js";
import { toolContext } from "./helpers/context.js";
import { tempWorkspace } from "./infrastructure/workspace.js";

let ws: Awaited<ReturnType<typeof tempWorkspace>>;
afterEach(async () => ws?.close());

describe("tools-fs native editor context registration", () => {
	it("registers inspect with the native adapter identity, outside the model catalog", async () => {
		ws = await tempWorkspace();
		const { ctx, registry } = toolContext("deny");
		const module = createToolsFsModule(ws);
		expect(module.manifest.provides).toContain("fs.context@1");
		expect(await module.activate(ctx)).toEqual({ ok: true, value: undefined });
		const context = registry.resolve<FsContextAdapter>("fs.context@1");
		const read = registry.resolve<ToolAdapter<unknown, unknown>>("fs.read@1");
		if (!context.ok || !read.ok)
			throw new Error("Native file adapters missing");
		expect(context.value[0].id).toBe(read.value[0].id);
		expect(context.value[0].trust).toBe(read.value[0].trust);
		expect(context.value[0].impl).not.toHaveProperty("run");
		expect(TOOL_CATALOG.some((tool) => tool.ref === "fs.context@1")).toBe(
			false,
		);
		await ws.put("main.ts", "source");
		const signal = new AbortController().signal;
		expect(
			await context.value[0].impl.inspect({ path: "main.ts" }, signal),
		).toEqual({
			ok: true,
			value: { path: "main.ts" },
		});
		const tree = join(ws.globalDir, "worktrees", "run", "task");
		const path = await ws.put("main.ts", "tree source", tree);
		expect(await context.value[0].impl.inspect({ path }, signal)).toMatchObject(
			{
				ok: false,
				error: { code: "outside_workspace" },
			},
		);
		expect(await read.value[0].impl.run({ path }, { signal })).toMatchObject({
			ok: true,
		});
	});
});
