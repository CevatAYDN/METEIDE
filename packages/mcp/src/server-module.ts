// The mcp-server module (docs/06, docs/10): METE's teams as MCP tools over a transport the host gives.
import {
	type ModuleManifest,
	ok,
	type TeamEngineV3Adapter,
} from "@mete/contracts";
import type { MeteModule } from "@mete/kernel";
import type { McpServer, Transport } from "@modelcontextprotocol/server";
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
	requires: ["team.engine@3"],
	optional: ["knowledge.search@1", "secrets.mask@1"],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: [],
};

/** Serves mete_run_team, mete_task_status, mete_approve and mete_knowledge_search on `opts.transport`. */
export const createMcpServerModule = (opts: McpServerOptions): MeteModule => {
	let server: McpServer | undefined;
	let lifetime: AbortController | undefined;
	return {
		manifest: MANIFEST,
		async activate(ctx) {
			// Only `mete mcp` provides a transport, and only then does the SDK's server load: every other
			// start would otherwise read the whole server graph for a module that never activates (docs/15, cold start).
			const { McpServer } = await import("@modelcontextprotocol/server");
			// Resolved per call: the engine module may activate after this one.
			const engine = () => {
				const r =
					ctx.capabilities.resolve<TeamEngineV3Adapter>("team.engine@3");
				return r.ok ? r.value[0].impl : undefined;
			};
			server = new McpServer({ name: "mete", version: MANIFEST.version });
			lifetime = new AbortController();
			registerMeteTools(server, {
				capabilities: ctx.capabilities,
				signal: lifetime.signal,
				engine,
				history: opts.history,
				logger: ctx.logger,
			});
			await server.connect(opts.transport);
			return ok(undefined);
		},
		async deactivate() {
			lifetime?.abort();
			await server?.close();
			server = undefined;
		},
	};
};
