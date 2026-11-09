import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ModuleManifest,
	Result,
	SecretStore,
	SkillSourceAdapter,
	SkillTrustAdapter,
	StorageSqlAdapter,
	TeamEngineV3Adapter,
	VcsGitAdapter,
} from "@mete/contracts";
import { err, ok } from "@mete/contracts";
import { createCoreEngineModule, type TemplateDirs } from "@mete/core";
import { createGatewayModule, type GatewayModule } from "@mete/gateway";
import {
	type CapabilityRegistry,
	type ConfigInvalid,
	type ConfigLayers,
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
	createKnowledgeSearchModule,
	createVaultModule,
} from "@mete/knowledge";
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
import { createNativeControls } from "../domain/native-controls.js";
import { runHistory } from "./history.js";
import { moduleLogger } from "./log.js";
import { offlineLookup } from "./scripted-web.js";
import { nativeSkillModules } from "./skill-modules.js";

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
	/** The level 2 mapping files folder; the repository's adapters/ by default (ADR-115). */
	readonly adaptersDir?: string;
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
	/** Module ids left out of the app; only the chaos test sets it (docs/15, Chaos). */
	readonly without?: readonly string[];
};

/** A started app. */
export type App = {
	/** The folder this app serves; Always allow writes its .mete/policy.yaml (ADR-121). */
	readonly workspaceDir: string;
	readonly registry: CapabilityRegistry;
	/** Actual native trust implementations; registry ids and trust labels are not authority. */
	readonly skillTrustAdapters: Pick<WeakSet<SkillTrustAdapter>, "has">;
	/** Optional for legacy hosts; editor lookup requires exact native source attestation. */
	readonly skillSourceAdapters?: Readonly<
		Pick<WeakSet<SkillSourceAdapter>, "has">
	>;
	readonly events: EventBus;
	readonly lifecycle: Lifecycle;
	readonly modules: readonly MeteModule[];
	/** Modules that failed to activate, such as a provider without its key, with the reason. */
	readonly inactive: readonly { moduleId: string; reason: string }[];
	/** The keychain the providers read; the pause hints check whether a provider has a key. */
	readonly secrets: SecretStore;
	/** The models the gateway may use after the privacy rules, from its cached listing. */
	readonly models: GatewayModule["models"];
	/** The chain a call for a tier and role would try, from the same listing (ADR-068). */
	readonly chain: GatewayModule["chain"];
	/** The listed facts of asked models, from the same listing (ADR-090). */
	readonly info: GatewayModule["info"];
	/** The chain an embedding would try, from the same listing (ADR-152). */
	readonly embedChain: GatewayModule["embedChain"];
	/** The template folders core-engine reads, which mete/templates lists (ADR-058). */
	readonly templates: TemplateDirs;
	/** The configuration files as loaded, and when (ADR-081). */
	readonly config: { readonly layers: ConfigLayers; readonly loadedAt: string };
	readonly stop: () => Promise<void>;
};

// The built-in folder unless a test names another, and the workspace's .mete/teams/ (docs/08).
const templatesOf = (opts: AppOptions): TemplateDirs => ({
	builtIn: opts.templatesDir ?? BUILT_IN_TEMPLATES,
	workspace: opts.workspaceDir,
});

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

const builtInProviders = () => [
	createNvidiaModule(),
	createOpenRouterModule(),
	createOpenCodeZenModule(),
	createGroqModule(),
	createGoogleModule(),
	createCustomModule(),
];

// A fetch given in place of the network, or a runner in place of Chromium, comes without DNS (ADR-171).
const webModules = (
	opts: AppOptions,
	dirs: { readonly workspaceDir: string; readonly globalDir: string },
) => [
	createToolsWebModule(
		opts.fetch ? { fetch: opts.fetch, lookup: offlineLookup } : {},
	),
	createBrowserModule({
		...dirs,
		...(opts.browser?.run ? { lookup: offlineLookup } : {}),
		...opts.browser,
	}),
];

const mcpClientFor = (opts: AppOptions, workspaceId: string) =>
	createMcpClientModule({
		workspaceDir: opts.workspaceDir,
		workspaceId,
		adaptersDir: opts.adaptersDir ?? BUILT_IN_ADAPTERS,
		globalDir: opts.globalDir,
		...(opts.fetch ? { fetch: opts.fetch } : {}),
		...(opts.elicit ? { elicit: opts.elicit } : {}),
		...(opts.confirm ? { confirm: opts.confirm } : {}),
		...(opts.authorize ? { authorize: opts.authorize } : {}),
	});

const gatewayViews = (gateway: GatewayModule) => ({
	models: gateway.models,
	chain: gateway.chain,
	info: gateway.info,
	embedChain: gateway.embedChain,
});

const modulesFor = (
	opts: AppOptions,
	workspaceId: string,
	registry: CapabilityRegistry,
	composition: {
		gateway: GatewayModule;
		skills: readonly MeteModule[];
		nativeControls: ReturnType<typeof createNativeControls>;
	},
): MeteModule[] => {
	const dirs = { workspaceDir: opts.workspaceDir, globalDir: opts.globalDir };
	const { gateway, skills, nativeControls } = composition;
	const checkpointAdapters = new WeakSet<VcsGitAdapter>();
	return [
		createStorageModule(dirs),
		createSecurityModule({ ...dirs, workspaceId }),
		createQuotaModule({ workspaceId }),
		...(opts.providers ?? builtInProviders()),
		gateway,
		createToolsFsModule(dirs),
		createToolsShellModule(dirs),
		...skills,
		createVcsGitModule({
			...dirs,
			onCheckpointAdapter: (adapter) => checkpointAdapters.add(adapter),
		}),
		...webModules(opts, dirs),
		createRegistryModule({
			globalDir: opts.globalDir,
			...(opts.fetch ? { fetch: opts.fetch } : {}),
		}),
		mcpClientFor(opts, workspaceId),
		createCoreEngineModule({
			workspaceId,
			checkpointAdapters,
			onNativeControls: nativeControls.onNativeControls,
			recover: opts.recover !== false,
			templates: templatesOf(opts),
			workspaceDir: opts.workspaceDir,
			// The global snapshots/ folder (ARCHITECTURE, Global contents; ADR-080).
			snapshotsDir: join(opts.globalDir, "snapshots"),
		}),
		// Each ended run's report in the workspace journal (docs/11, Run reports; ADR-144).
		createVaultModule({ workspaceDir: opts.workspaceDir, workspaceId }),
		// The vault's notes by keywords (docs/11, Hybrid search; ADR-149).
		createKnowledgeSearchModule(),
		...servedBy(opts, registry),
	].filter((m) => !opts.without?.includes(m.manifest.id));
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

// The modules that stopped and why, as module.deactivated reports them.
const deactivated = (events: EventBus) => {
	const inactive: { moduleId: string; reason: string }[] = [];
	events.subscribe(
		"module.deactivated",
		({ payload: { moduleId, reason } }) => {
			if (reason) inactive.push({ moduleId, reason });
		},
	);
	return inactive;
};

const appModules = (
	opts: AppOptions,
	workspaceId: string,
	registry: CapabilityRegistry,
) => {
	const gateway = createGatewayModule();
	const nativeControls = createNativeControls();
	const skills = nativeSkillModules(
		opts,
		workspaceId,
		registry,
		nativeControls.view,
	);
	const composition = { gateway, skills: skills.modules, nativeControls };
	const modules = modulesFor(opts, workspaceId, registry, composition);
	return { gateway, skills, modules };
};

/** Loads the configuration, registers every module, starts the kernel and opens the workspace. */
export const createApp = async (
	opts: AppOptions,
): Promise<Result<App, readonly ConfigInvalid[]>> => {
	const config = await loadConfig(opts, BUILT_IN_BINDINGS);
	if (!config.ok) return err(config.error);
	const { workspaceId, reader, bindings, layers } = config.value;
	const loadedAt = new Date().toISOString();
	const registry = createCapabilityRegistry(bindings);
	// shortcut: one shared bus, so a throwing handler is logged instead of reported as its
	// module's crash; per-module bus views come with the daemon.
	const events = createEventBus((error, e) =>
		opts.logger.error({ err: error, type: e.type }, "event handler threw"),
	);
	const inactive = deactivated(events);
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
	const { gateway, skills, modules } = appModules(opts, workspaceId, registry);
	for (const m of modules) await lifecycle.register(m);
	await lifecycle.start();
	await lifecycle.openWorkspace();
	return ok({
		workspaceDir: opts.workspaceDir,
		registry,
		skillTrustAdapters: skills.skillTrustAdapters,
		skillSourceAdapters: skills.skillSourceAdapters,
		events,
		lifecycle,
		modules,
		inactive,
		secrets,
		...gatewayViews(gateway),
		templates: templatesOf(opts),
		config: { layers, loadedAt },
		stop: lifecycle.stop,
	});
};

/** Why team.engine@3 is missing: the modules still waiting and the capabilities they wait for. */
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
export const engineOf = (app: App): Result<TeamEngineV3Adapter, string[]> => {
	const r = app.registry.resolve<TeamEngineV3Adapter>("team.engine@3");
	if (r.ok) return ok(r.value[0].impl);
	const off = app.inactive.map(
		(m) => `${m.moduleId} is not active (${m.reason})`,
	);
	return err(["core-engine is not active.", ...waiting(app), ...off]);
};
