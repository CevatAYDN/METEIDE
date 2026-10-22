// MeteModule entry (docs/06-kernel-and-modules.md). Modules in this package: mcp-client (here);
// mcp-server and registry follow in later Phase 3 slices.
import {
	err,
	McpConfigSchema,
	type McpServer,
	type ModuleManifest,
	ok,
	type PolicyCheckAdapter,
} from "@mete/contracts";
import type {
	CapabilityRegistry,
	MeteModule,
	ModuleContext,
} from "@mete/kernel";
import { mcpTools } from "./application/mcp-tools.js";
import { provideMappings } from "./application/provide-mappings.js";
import { createSessions, type Sessions } from "./application/sessions.js";
import {
	type OpenTransport,
	openTransport,
} from "./infrastructure/transport.js";

/** What mcp-client is given; tests pass their own transports. */
export type McpClientOptions = {
	readonly workspaceDir: string;
	/** The built-in adapters/ folder of level 2 mapping files (docs/10). */
	readonly adaptersDir?: string;
	readonly open?: OpenTransport;
};

const MANIFEST: ModuleManifest = {
	id: "mcp-client",
	version: "0.0.0",
	displayName: "MCP client",
	class: "optional",
	trust: "core",
	provides: ["mcp.tools@1"],
	requires: ["policy.check@1"],
	optional: ["registry.search@1"],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["shell", "net", "fs.write"],
};

const policyOf =
	(registry: CapabilityRegistry) => (): PolicyCheckAdapter | undefined => {
		const r = registry.resolve<PolicyCheckAdapter>("policy.check@1");
		return r.ok ? r.value[0].impl : undefined;
	};

// mcp.tools@1 for raw calls, then one adapter per runnable mapping entry.
const provideAll = async (
	ctx: ModuleContext,
	opts: McpClientOptions,
	servers: readonly McpServer[],
	sessions: Sessions,
) => {
	const policy = policyOf(ctx.capabilities);
	const { workspaceDir } = opts;
	const impl = mcpTools({
		adapterId: MANIFEST.id,
		workspaceDir,
		sessions,
		policy,
		logger: ctx.logger,
	});
	ctx.disposables.add(
		ctx.capabilities.provide("mcp.tools@1", {
			id: MANIFEST.id,
			trust: "core",
			features: [],
			impl,
		}),
	);
	if (!opts.adaptersDir) return;
	const deps = {
		moduleId: MANIFEST.id,
		workspaceDir,
		sessions,
		policy,
		servers,
	};
	await provideMappings(ctx, deps, opts.adaptersDir);
};

/** The mcp-client module: mcp.tools@1 over the servers of mcp.yaml (docs/10, MCP client). */
export const createMcpClientModule = (opts: McpClientOptions): MeteModule => {
	let sessions: Sessions | undefined;
	return {
		manifest: MANIFEST,
		async activate(ctx) {
			const config = ctx.config.get("mcp", McpConfigSchema);
			if (!config.ok) {
				const { file, path, reason } = config.error;
				return err({
					code: "activation_failed",
					moduleId: MANIFEST.id,
					message: `${file} ${path}: ${reason}`,
				});
			}
			sessions = createSessions({
				moduleId: MANIFEST.id,
				version: MANIFEST.version,
				servers: config.value.servers,
				open: opts.open ?? openTransport,
				logger: ctx.logger,
			});
			await provideAll(ctx, opts, config.value.servers, sessions);
			return ok(undefined);
		},
		async deactivate() {
			await sessions?.close();
			sessions = undefined;
		},
	};
};
