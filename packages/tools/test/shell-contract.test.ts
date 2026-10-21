import type {
	ShellExecInput,
	ShellExecOutput,
	ToolAdapter,
} from "@mete/contracts";
import { shellExecContract } from "@mete/testing";
import { createToolsShellModule } from "../src/module.js";
import { toolContext } from "./helpers/context.js";
import { tempWorkspace } from "./infrastructure/workspace.js";

shellExecContract("tools-shell", async (verdict) => {
	const ws = await tempWorkspace();
	const { ctx, registry } = toolContext(verdict);
	const r = await createToolsShellModule(ws).activate(ctx);
	if (!r.ok) throw new Error(r.error.message);
	const c =
		registry.resolve<ToolAdapter<ShellExecInput, ShellExecOutput>>(
			"shell.exec@1",
		);
	if (!c.ok) throw new Error("shell.exec@1 missing");
	return { adapter: c.value[0].impl, close: ws.close };
});
