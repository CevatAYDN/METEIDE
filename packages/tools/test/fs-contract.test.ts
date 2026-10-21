import type { ToolAdapter } from "@mete/contracts";
import { type FsTools, fsToolsContract } from "@mete/testing";
import { createToolsFsModule } from "../src/module.js";
import { toolContext } from "./helpers/context.js";
import { tempWorkspace } from "./infrastructure/workspace.js";

fsToolsContract("tools-fs", async (verdict) => {
	const ws = await tempWorkspace();
	const { ctx, registry } = toolContext(verdict);
	const r = await createToolsFsModule(ws).activate(ctx);
	if (!r.ok) throw new Error(r.error.message);
	const get = <I, O>(ref: `fs.${string}@1`) => {
		const c = registry.resolve<ToolAdapter<I, O>>(ref);
		if (!c.ok) throw new Error(`${ref} missing`);
		return c.value[0].impl;
	};
	const tools: FsTools = {
		read: get("fs.read@1"),
		write: get("fs.write@1"),
		edit: get("fs.edit@1"),
		list: get("fs.list@1"),
		glob: get("fs.glob@1"),
		grep: get("fs.grep@1"),
	};
	return { tools, close: ws.close };
});
