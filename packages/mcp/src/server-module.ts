// The mcp-server module (docs/06, docs/10): METE's teams as MCP tools over a transport the host gives.
import {
	type ModuleManifest,
	ok,
	type TeamEngineAdapter,
} from "@mete/contracts";
import type { MeteModule } from "@mete/kernel";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
	type RunHistory,
	registerMeteTools,
} from "./application/mete-tools.js";

/** What mcp-server is given: the transport it serves and how a run's events are read. */
export type McpServerOptions = {
	readonly transport: Transport;
	readonly history: RunHistory;
};

const MANIFEST: ModuleManifest = {
	id: "mcp-server",
	version: "0.0.0",
	displayName: "METE as an MCP server",
	class: "optional",
	trust: "core",
	provides: [],
	requires: ["team.engine@2"],
	optional: ["knowledge.search@1"],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: [],
};

/** Serves mete_run_team, mete_task_status, mete_approve and mete_knowledge_search on `opts.transport`. */
export const createMcpServerModule = (opts: McpServerOptions): MeteModule => {
	let server: McpServer | undefined;
	return {
		manifest: MANIFEST,
		async activate(ctx) {
			// Only `mete mcp` provides a transport, and only then does the SDK's server load: every other
			// start would otherwise read the whole server graph for a module that never activates (docs/15, cold start).
			const { McpServer } = await import(
				"@modelcontextprotocol/sdk/server/mcp.js"
			);
			// Resolved per call: the engine module may activate after this one.
			const engine = () => {
				const r = ctx.capabilities.resolve<TeamEngineAdapter>("team.engine@2");
				return r.ok ? r.value[0].impl : undefined;
			};
			server = new McpServer({ name: "mete", version: MANIFEST.version });
			registerMeteTools(server, {
				engine,
				history: opts.history,
				logger: ctx.logger,
			});
			await server.connect(opts.transport);
			return ok(undefined);
		},
		async deactivate() {
			await server?.close();
			server = undefined;
		},
	};
};
