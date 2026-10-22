import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type {
	ToolAdapter,
	WebSearchInput,
	WebSearchOutput,
} from "@mete/contracts";
import { webSearchContract } from "@mete/testing";
import { createMcpClientModule } from "../src/module.js";
import { moduleContext } from "./helpers/context.js";

const FIXTURE = fileURLToPath(
	new URL("./fixtures/server.mjs", import.meta.url),
);
const ADAPTERS = fileURLToPath(new URL("../../../adapters/", import.meta.url));

// The shipped exa-mcp mapping over the fixture stdio server, which plays Exa's web_search_advanced_exa:
// it answers the hits the kit sets through its environment, at most numResults of them, or an outage.
webSearchContract("mcp exa-mcp mapping", async (verdict, world) => {
	const env =
		world === "down"
			? { EXA_DOWN: "1" }
			: { EXA_HITS: JSON.stringify(world.hits) };
	const module = createMcpClientModule({
		workspaceDir: tmpdir(),
		adaptersDir: ADAPTERS,
		builtInServers: [],
	});
	const server = {
		id: "exa",
		transport: "stdio",
		runtime: "node",
		command: process.execPath,
		args: [FIXTURE],
		env,
		permissions: [],
	};
	const c = moduleContext(verdict, { mcp: { servers: [server] } });
	const activated = await module.activate(c.ctx);
	if (!activated.ok) throw new Error(activated.error.message);
	const found =
		c.registry.resolve<ToolAdapter<WebSearchInput, WebSearchOutput>>(
			"web.search@1",
		);
	const adapter = found.ok
		? found.value.find((a) => a.id === "exa-mcp")?.impl
		: undefined;
	if (!adapter) throw new Error("exa-mcp is not provided");
	return { adapter, close: () => module.deactivate() };
});
