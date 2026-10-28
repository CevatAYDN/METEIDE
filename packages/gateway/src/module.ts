// MeteModule entry (docs/06-kernel-and-modules.md). Modules in this package: gateway.
import { setTimeout as delay } from "node:timers/promises";
import {
	type CapabilityRef,
	err,
	GatewaySettingsSchema,
	type LlmChatAdapter,
	type LlmChatRequest,
	type ModelInfo,
	type ModelRef,
	type ModuleManifest,
	ok,
	PrivacyConfigSchema,
	type ProviderAdapter,
	type QuotaReserveAdapter,
	type SecretsMaskAdapter,
} from "@mete/contracts";
import type {
	CapabilityRegistry,
	MeteModule,
	ModuleContext,
	ModuleError,
} from "@mete/kernel";
import { z } from "zod";
import { createLlmChat } from "./application/chat.js";
import { createDiscovery } from "./application/prepare.js";
import { MODEL_CALL_RETENTION_DAYS } from "./defaults.js";
import {
	type PrivacyRules,
	resolveChain,
	usableModels,
} from "./domain/resolve.js";
import { spendSpec } from "./domain/spend.js";
import {
	createModelCallLog,
	MODEL_CALL_MIGRATIONS,
	type ModelCall,
} from "./infrastructure/model-calls.js";

/** Clock and sleep are injectable for tests. */
export type GatewayOptions = {
	readonly now?: () => number;
	readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

const MANIFEST: ModuleManifest = {
	id: "gateway",
	version: "0.0.0",
	displayName: "Gateway",
	class: "essential",
	trust: "core",
	provides: ["llm.chat@2"],
	requires: [
		"storage.sql@1",
		"quota.reserve@4",
		"secrets.mask@1",
		"provider.chat@2",
	],
	optional: ["provider.embed@1", "provider.rerank@1"],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: [],
};

// The kernel checks workspace.yaml's id; the gateway reads only its sensitivity (docs/09, Privacy).
const WorkspaceSchema = z
	.looseObject({
		sensitivity: z.enum(["normal", "sensitive"]).default("normal"),
	})
	.prefault({});

const DAY_MS = 86_400_000;

const failed = (message: string): ModuleError => ({
	code: "activation_failed",
	moduleId: MANIFEST.id,
	message,
});

// Ends at once on an already aborted signal and removes its own abort listener; the
// pipeline checks the signal after the wait, so the abort rejection is dropped.
const realSleep = (ms: number, signal: AbortSignal) =>
	delay(ms, undefined, { signal }).catch(() => undefined);

const first = <C>(registry: CapabilityRegistry, ref: CapabilityRef): C => {
	const r = registry.resolve<C>(ref);
	if (!r.ok) throw new Error(`${ref} is required but not provided`);
	return r.value[0].impl;
};

// The privacy rules and the model mode with its spending cap (ADR-042), read at activation.
const readRules = (ctx: ModuleContext) => {
	const privacy = ctx.config.get("privacy", PrivacyConfigSchema);
	if (!privacy.ok) return err(privacy.error);
	const settings = ctx.config.get("gateway", GatewaySettingsSchema);
	if (!settings.ok) return err(settings.error);
	const workspace = ctx.config.get("workspace", WorkspaceSchema);
	if (!workspace.ok) return err(workspace.error);
	const sensitive = workspace.value.sensitivity === "sensitive";
	return ok({
		rules: {
			allowTraining: privacy.value.allowTraining,
			sensitive,
			mode: settings.value.models,
		} satisfies PrivacyRules,
		dailySpendUsd: settings.value.dailySpendUsd,
	});
};

// Listings are kept per quota adapter: a restarted quota module has no units defined.
const discovery = (ctx: ModuleContext, dailySpendUsd: number) => {
	let kept:
		| {
				quota: QuotaReserveAdapter;
				discover: ReturnType<typeof createDiscovery>;
		  }
		| undefined;
	const providers = () => {
		const r = ctx.capabilities.resolve<ProviderAdapter>("provider.chat@2");
		return r.ok ? r.value.map((a) => a.impl) : [];
	};
	return (signal: AbortSignal) => {
		const quota = first<QuotaReserveAdapter>(
			ctx.capabilities,
			"quota.reserve@4",
		);
		if (kept?.quota !== quota) {
			// The spending cap is METE's own unit over every provider (ADR-042).
			quota.define([spendSpec(dailySpendUsd)]);
			const warn = (msg: string) => ctx.logger.warn({}, msg);
			kept = {
				quota,
				discover: createDiscovery({
					providers,
					define: (s) => quota.define(s),
					warn,
				}),
			};
		}
		return kept.discover(signal);
	};
};

// What an active gateway serves from: its discovery and the privacy rules read at activation.
type Live = {
	readonly discover: ReturnType<typeof discovery>;
	readonly rules: PrivacyRules;
};

const buildChat = (
	ctx: ModuleContext,
	live: Live,
	opts: Required<GatewayOptions>,
	write: (c: ModelCall) => void,
): LlmChatAdapter => {
	const quota = () =>
		first<QuotaReserveAdapter>(ctx.capabilities, "quota.reserve@4");
	return createLlmChat({
		discover: live.discover,
		quota: {
			define: (s) => quota().define(s),
			reserve: (req, signal) => quota().reserve(req, signal),
			settle: (id, actual, obs) => quota().settle(id, actual, obs),
		},
		mask: {
			mask: (t) =>
				first<SecretsMaskAdapter>(ctx.capabilities, "secrets.mask@1").mask(t),
		},
		rules: () => live.rules,
		warn: (fields, msg) => ctx.logger.warn(fields, msg),
		sleep: opts.sleep,
		now: opts.now,
		record: write,
	});
};

// Prunes old rows and a removed run's (ADR-143); a failed write is reported, never thrown into the
// caller's stream.
const openLog = (
	ctx: ModuleContext,
	db: Parameters<typeof createModelCallLog>[0],
	now: () => number,
) => {
	const log = createModelCallLog(db);
	log.prune(new Date(now() - MODEL_CALL_RETENTION_DAYS * DAY_MS).toISOString());
	ctx.disposables.add(
		ctx.events.subscribe("run.removed", (e) => {
			if (e.runId) log.removeRun(e.runId);
		}),
	);
	return (c: ModelCall) => {
		try {
			log.write(c);
		} catch (error) {
			ctx.logger.warn({ error: String(error) }, "model_calls row not written");
		}
	};
};

const usableRefs = async (
	live: Live | undefined,
	signal: AbortSignal,
): Promise<ModelRef[]> => {
	if (!live) return [];
	const found = await live.discover(signal);
	return usableModels(found, live.rules).map((m) => ({
		providerId: m.providerId,
		modelId: m.id,
	}));
};

// The chain a call for this target and role would try, best first, from the cached listing: no model
// call and no quota reservation (ADR-068, the composer's estimate).
const chainRefs = async (
	live: Live | undefined,
	[target, role, signal]: Parameters<GatewayModule["chain"]>,
): Promise<ModelRef[]> => {
	if (!live) return [];
	const found = await live.discover(signal);
	return resolveChain(found, target, live.rules, role).map((m) => ({
		providerId: m.providerId,
		modelId: m.id,
	}));
};

// The listed facts of the asked models, in the order asked, from the cached listing: no model call
// and no quota reservation (ADR-090, the Team view's context share).
const infoOf = async (
	live: Live | undefined,
	refs: readonly ModelRef[],
	signal: AbortSignal,
): Promise<ModelInfo[]> => {
	if (!live) return [];
	const found = (await live.discover(signal)).map((d) => d.model);
	return refs.flatMap((r) =>
		found.filter((m) => m.providerId === r.providerId && m.id === r.modelId),
	);
};

/** The gateway module and the models it offers, for `/v1/models`. */
export type GatewayModule = MeteModule & {
	/** Usable discovered models; empty while the module is inactive. */
	models(signal: AbortSignal): Promise<ModelRef[]>;
	/** The chain a call for this target and role would try, best first; empty while inactive. */
	chain(
		target: LlmChatRequest["target"],
		role: Parameters<typeof resolveChain>[3],
		signal: AbortSignal,
	): Promise<ModelRef[]>;
	/** The listed facts of the asked models, in the order asked; empty while inactive. */
	info(refs: readonly ModelRef[], signal: AbortSignal): Promise<ModelInfo[]>;
};

/** Creates the gateway module, which provides llm.chat@2. */
export const createGatewayModule = (
	options: GatewayOptions = {},
): GatewayModule => {
	const opts = {
		now: options.now ?? Date.now,
		sleep: options.sleep ?? realSleep,
	};
	let live: Live | undefined;
	return {
		manifest: MANIFEST,
		models: (signal) => usableRefs(live, signal),
		chain: (...args) => chainRefs(live, args),
		info: (refs, signal) => infoOf(live, refs, signal),
		async activate(ctx) {
			if (!ctx.storage) return err(failed("storage.sql@1 was not provided"));
			const migrated = ctx.storage.migrate("workspace", MODEL_CALL_MIGRATIONS);
			if (!migrated.ok) return err(failed(migrated.error.message));
			const rules = readRules(ctx);
			if (!rules.ok) {
				const { file, path, reason } = rules.error;
				return err(failed(`${file} ${path}: ${reason}`));
			}
			const write = openLog(ctx, ctx.storage.workspace, opts.now);
			const { dailySpendUsd } = rules.value;
			live = {
				discover: discovery(ctx, dailySpendUsd),
				rules: rules.value.rules,
			};
			const impl = buildChat(ctx, live, opts, write);
			ctx.disposables.add(
				ctx.capabilities.provide("llm.chat@2", {
					id: MANIFEST.id,
					trust: "core",
					features: [],
					impl,
				}),
			);
			return ok(undefined);
		},
		async deactivate() {
			live = undefined;
		},
	};
};
