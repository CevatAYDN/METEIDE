// MeteModule entry (docs/06-kernel-and-modules.md). Modules in this package: mcp-client (here),
// mcp-server (server-module.ts); registry follows in a later Phase 3 slice.
import {
	err,
	type LlmChatAdapter,
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
import { type Calls, createCalls } from "./application/calls.js";
import { mcpTools } from "./application/mcp-tools.js";
import { provideMappings } from "./application/provide-mappings.js";
import { createRuntimeEnsure } from "./application/runtime-ensure.js";
import { type Confirm, createSampling } from "./application/sampling.js";
import {
	createSessions,
	type Elicit,
	type Sessions,
} from "./application/sessions.js";
import type { Authorize } from "./application/sign-in.js";
import { BUILT_IN_SERVERS } from "./defaults.js";
import {
	type RuntimeSystem,
	runtimeSystem,
} from "./infrastructure/runtime-system.js";
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
	/** The fetch remote servers use; tests pass a fake, so nothing reaches the network. */
	readonly fetch?: typeof fetch;
	/** Servers added to mcp.yaml's by id; tests pass none. */
	readonly builtInServers?: readonly McpServer[];
	/** The global folder whose runtimes/ holds managed runtimes; without it runtime.ensure@1 is not provided. */
	readonly globalDir?: string;
	/** What the runtime manager asks of the machine; tests pass a fake. */
	readonly runtimeSystem?: RuntimeSystem;
	/** How the host asks the user when a server requests input; without it elicitation is not offered. */
	readonly elicit?: Elicit;
	/** How the host asks the user a yes or no question; without it sampling is not offered. */
	readonly confirm?: Confirm;
	/** How the host sends the user to sign in to an OAuth server once; without it only saved tokens work. */
	readonly authorize?: Authorize;
};

// mcp.yaml's servers first; a built-in server fills in only when no entry has its id (docs/10).
const withBuiltIns = (
	servers: readonly McpServer[],
	builtIn: readonly McpServer[],
) => [
	...servers,
	...builtIn.filter((b) => !servers.some((s) => s.id === b.id)),
];

const MANIFEST: ModuleManifest = {
	id: "mcp-client",
	version: "0.0.0",
	displayName: "MCP client",
	class: "optional",
	trust: "core",
	provides: ["mcp.tools@1", "runtime.ensure@1"],
	requires: ["policy.check@1"],
	optional: ["registry.search@1", "llm.chat@1"],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["shell", "net", "fs.write", "secrets"],
};

const chatOf =
	(registry: CapabilityRegistry) => (): LlmChatAdapter | undefined => {
		const r = registry.resolve<LlmChatAdapter>("llm.chat@1");
		return r.ok ? r.value[0].impl : undefined;
	};

const policyOf =
	(registry: CapabilityRegistry) => (): PolicyCheckAdapter | undefined => {
		const r = registry.resolve<PolicyCheckAdapter>("policy.check@1");
		return r.ok ? r.value[0].impl : undefined;
	};

// Sampling is offered only when the host can ask the user (docs/10, MCP client).
const samplingOf = (
	ctx: ModuleContext,
	opts: McpClientOptions,
	calls: Calls,
) =>
	opts.confirm
		? createSampling({
				adapterId: MANIFEST.id,
				policy: policyOf(ctx.capabilities),
				chat: chatOf(ctx.capabilities),
				confirm: opts.confirm,
				current: calls.current,
			})
		: undefined;

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

// runtime.ensure@1 for this module's stdio servers and for other modules (docs/10, Managed runtimes).
const runtimeEnsure = (ctx: ModuleContext, opts: McpClientOptions) => {
	if (!opts.globalDir) return undefined;
	const impl = createRuntimeEnsure({
		adapterId: MANIFEST.id,
		globalDir: opts.globalDir,
		platform: `${process.platform}-${process.arch}`,
		policy: policyOf(ctx.capabilities),
		fetch: opts.fetch ?? fetch,
		system: opts.runtimeSystem ?? runtimeSystem,
	});
	ctx.disposables.add(
		ctx.capabilities.provide("runtime.ensure@1", {
			id: MANIFEST.id,
			trust: "core",
			features: [],
			impl,
		}),
	);
	return impl;
};

// The connections of every configured server, with what the host lets them ask of the user and the model.
const openSessions = (
	ctx: ModuleContext,
	opts: McpClientOptions,
	servers: readonly McpServer[],
) => {
	const ensure = runtimeEnsure(ctx, opts);
	const calls = createCalls();
	const sample = samplingOf(ctx, opts, calls);
	return createSessions({
		moduleId: MANIFEST.id,
		version: MANIFEST.version,
		servers,
		workspaceDir: opts.workspaceDir,
		open: opts.open ?? openTransport,
		...(opts.fetch ? { fetch: opts.fetch } : {}),
		logger: ctx.logger,
		...(ensure ? { ensure } : {}),
		...(opts.elicit ? { elicit: opts.elicit } : {}),
		calls,
		...(sample ? { sample } : {}),
		...(ctx.secrets ? { secrets: ctx.secrets } : {}),
		...(opts.authorize ? { authorize: opts.authorize } : {}),
	});
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
			const servers = withBuiltIns(
				config.value.servers,
				opts.builtInServers ?? BUILT_IN_SERVERS,
			);
			sessions = openSessions(ctx, opts, servers);
			await provideAll(ctx, opts, servers, sessions);
			return ok(undefined);
		},
		async deactivate() {
			await sessions?.close();
			sessions = undefined;
		},
	};
};
