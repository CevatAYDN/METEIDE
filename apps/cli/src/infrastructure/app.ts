import { fileURLToPath } from "node:url";
import type {
	ModuleManifest,
	Result,
	SecretStore,
	StorageSqlAdapter,
	TeamEngineAdapter,
} from "@mete/contracts";
import { err, ok } from "@mete/contracts";
import { createCoreEngineModule } from "@mete/core";
import { createGatewayModule } from "@mete/gateway";
import {
	type CapabilityRegistry,
	type ConfigInvalid,
	createCapabilityRegistry,
	createEventBus,
	createLifecycle,
	type EventBus,
	type Lifecycle,
	type Logger,
	loadConfig,
	type MeteModule,
	type ModuleContext,
} from "@mete/kernel";
import {
	type Authorize,
	type Confirm,
	createMcpClientModule,
	createMcpServerModule,
	createRegistryModule,
	type Elicit,
	type Transport,
} from "@mete/mcp";
import {
	createCustomModule,
	createGoogleModule,
	createGroqModule,
	createNvidiaModule,
	createOpenCodeZenModule,
	createOpenRouterModule,
} from "@mete/providers";
import { createQuotaModule } from "@mete/quota";
import { createKeychainStore, createSecurityModule } from "@mete/security";
import { createStorageModule } from "@mete/storage";
import {
	type BrowserOptions,
	createBrowserModule,
	createToolsFsModule,
	createToolsShellModule,
	createToolsWebModule,
	createVcsGitModule,
} from "@mete/tools";
import { BUILT_IN_BINDINGS } from "../defaults.js";
import { runHistory } from "./history.js";
import { moduleLogger } from "./log.js";

// The CLI's composition root (ARCHITECTURE.md, CLI): one workspace, every Phase 1 module in
// this process, the lifecycle stopped before exit.

// The repository's templates/ folder, four levels up from src/ and dist/ files (ARCHITECTURE.md).
// shortcut: found through the source tree; packaged builds ship templates with the desktop (Phase 5).
const BUILT_IN_TEMPLATES = fileURLToPath(
	new URL("../../../../templates/", import.meta.url),
);
// The repository's adapters/ folder of level 2 mapping files, found the same way.
const BUILT_IN_ADAPTERS = fileURLToPath(
	new URL("../../../../adapters/", import.meta.url),
);

/** What the app is built from; secrets and providers are replaceable for tests. */
export type AppOptions = {
	readonly workspaceDir: string;
	readonly globalDir: string;
	readonly logger: Logger;
	readonly secrets?: SecretStore;
	/** Modules that provide provider.chat@2; the four built-in ones by default. */
	readonly providers?: readonly MeteModule[];
	/** Only the process that drives runs recovers them (docs/07); default true. */
	readonly recover?: boolean;
	/** The built-in templates folder; the repository's templates/ by default. */
	readonly templatesDir?: string;
	/** The fetch tools-web and remote MCP servers use; tests pass a fake, so nothing reaches the network. */
	readonly fetch?: typeof fetch;
	/** The browser runner and Chromium; tests pass fakes, so no browser starts. */
	readonly browser?: Pick<BrowserOptions, "run" | "chromium">;
	/** How MCP servers ask the user for input; only a command with a terminal sets it, so a server that asks otherwise gets an error. */
	readonly elicit?: Elicit;
	/** How an MCP server's sampling request asks the user once; only a command with a terminal sets it. */
	readonly confirm?: Confirm;
	/** How the user signs in to a remote MCP server once; only a command with a terminal sets it. */
	readonly authorize?: Authorize;
	/** Only `mete mcp` sets it: the transport mcp-server answers on (docs/10). */
	readonly serve?: Transport;
};

/** A started app. */
export type App = {
	readonly registry: CapabilityRegistry;
	readonly events: EventBus;
	readonly lifecycle: Lifecycle;
	readonly modules: readonly MeteModule[];
	/** Modules that failed to activate, such as a provider without its key, with the reason. */
	readonly inactive: readonly { moduleId: string; reason: string }[];
	readonly stop: () => Promise<void>;
};

const disposables = () => {
	const items: { dispose(): void }[] = [];
	return {
		add: (d: { dispose(): void }) => void items.push(d),
		dispose: () => {
			for (const d of items.splice(0).reverse()) d.dispose();
		},
	};
};

// mcp-server reads run events through the registry, so it can be built before the app exists.
const servedBy = (opts: AppOptions, registry: CapabilityRegistry) =>
	opts.serve
		? [
				createMcpServerModule({
					transport: opts.serve,
					history: (runId) => runHistory(registry, runId),
				}),
			]
		: [];

const modulesFor = (
	opts: AppOptions,
	workspaceId: string,
	registry: CapabilityRegistry,
): MeteModule[] => {
	const dirs = { workspaceDir: opts.workspaceDir, globalDir: opts.globalDir };
	return [
		createStorageModule(dirs),
		createSecurityModule(dirs),
		createQuotaModule({ workspaceId }),
		...(opts.providers ?? [
			createNvidiaModule(),
			createOpenRouterModule(),
			createOpenCodeZenModule(),
			createGroqModule(),
			createGoogleModule(),
			createCustomModule(),
		]),
		createGatewayModule(),
		createToolsFsModule(dirs),
		createToolsShellModule(dirs),
		createVcsGitModule(dirs),
		createToolsWebModule(opts.fetch ? { fetch: opts.fetch } : {}),
		createBrowserModule({ ...dirs, ...opts.browser }),
		createRegistryModule({
			globalDir: opts.globalDir,
			...(opts.fetch ? { fetch: opts.fetch } : {}),
		}),
		createMcpClientModule({
			workspaceDir: opts.workspaceDir,
			adaptersDir: BUILT_IN_ADAPTERS,
			globalDir: opts.globalDir,
			...(opts.fetch ? { fetch: opts.fetch } : {}),
			...(opts.elicit ? { elicit: opts.elicit } : {}),
			...(opts.confirm ? { confirm: opts.confirm } : {}),
			...(opts.authorize ? { authorize: opts.authorize } : {}),
		}),
		createCoreEngineModule({
			workspaceId,
			recover: opts.recover !== false,
			templates: {
				builtIn: opts.templatesDir ?? BUILT_IN_TEMPLATES,
				workspace: opts.workspaceDir,
			},
			workspaceDir: opts.workspaceDir,
		}),
		...servedBy(opts, registry),
	];
};

// storage only with storage.sql@1 in requires, secrets only with the secrets permission (docs/06).
const contextOf =
	(
		base: Omit<ModuleContext, "logger" | "disposables">,
		logger: Logger,
		secrets: SecretStore,
	) =>
	(m: ModuleManifest): ModuleContext => {
		const sql = m.requires.includes("storage.sql@1")
			? base.capabilities.resolve<StorageSqlAdapter>("storage.sql@1")
			: undefined;
		return {
			...base,
			logger: moduleLogger(logger, m.id),
			disposables: disposables(),
			...(sql?.ok ? { storage: sql.value[0].impl.scopeFor(m.id) } : {}),
			...(m.permissions.includes("secrets") ? { secrets } : {}),
		};
	};

/** Loads the configuration, registers every module, starts the kernel and opens the workspace. */
export const createApp = async (
	opts: AppOptions,
): Promise<Result<App, readonly ConfigInvalid[]>> => {
	const config = await loadConfig(opts, BUILT_IN_BINDINGS);
	if (!config.ok) return err(config.error);
	const { workspaceId, reader, bindings } = config.value;
	const registry = createCapabilityRegistry(bindings);
	// shortcut: one shared bus, so a throwing handler is logged instead of reported as its
	// module's crash; per-module bus views come with the daemon.
	const events = createEventBus((error, e) =>
		opts.logger.error({ err: error, type: e.type }, "event handler threw"),
	);
	const inactive: { moduleId: string; reason: string }[] = [];
	events.subscribe(
		"module.deactivated",
		({ payload: { moduleId, reason } }) => {
			if (reason) inactive.push({ moduleId, reason });
		},
	);
	const secrets = opts.secrets ?? createKeychainStore();
	const base = { capabilities: registry, events, config: reader };
	const contextFor = contextOf(base, opts.logger, secrets);
	const lifecycle = createLifecycle({
		registry,
		events,
		workspaceId,
		contextFor,
		logger: opts.logger,
	});
	const modules = modulesFor(opts, workspaceId, registry);
	for (const m of modules) await lifecycle.register(m);
	await lifecycle.start();
	await lifecycle.openWorkspace();
	return ok({
		registry,
		events,
		lifecycle,
		modules,
		inactive,
		stop: lifecycle.stop,
	});
};

/** Why team.engine@2 is missing: the modules still waiting and the capabilities they wait for. */
export const waiting = (app: App) =>
	app.modules.flatMap((m) => {
		const { id, requires } = m.manifest;
		if (app.lifecycle.state(id) !== "resolving") return [];
		const missing = requires.filter((r) => !app.registry.has(r));
		return [`${id} waits for ${missing.join(", ")}`];
	});

/** The lines `engineOf` gave plus, when a provider is inactive, how to add its key. */
export const notReadyLines = (app: App, lines: readonly string[]) => [
	...lines,
	...(app.inactive.some((m) => m.moduleId.startsWith("provider-"))
		? ["Add a provider key with: mete key set openrouter"]
		: []),
];

/** The engine, or the lines that say why it is not active. */
export const engineOf = (app: App): Result<TeamEngineAdapter, string[]> => {
	const r = app.registry.resolve<TeamEngineAdapter>("team.engine@2");
	if (r.ok) return ok(r.value[0].impl);
	const off = app.inactive.map(
		(m) => `${m.moduleId} is not active (${m.reason})`,
	);
	return err(["core-engine is not active.", ...waiting(app), ...off]);
};
