// MeteModule entry (docs/06-kernel-and-modules.md). Modules in this package: security.
import { homedir } from "node:os";
import {
	err,
	type ModuleManifest,
	ok,
	type Policy,
	type PolicyCheckInput,
	type PolicyGrantAdapter,
	PolicySchema,
	type SecretsMaskAdapter,
	type SkillRuntimeAdapter,
	type SkillSelectionAdapter,
} from "@mete/contracts";
import type {
	Disposable,
	MeteModule,
	ModuleContext,
	ModuleError,
} from "@mete/kernel";
import { createGrants } from "./application/grants.js";
import {
	type AuditWriter,
	type CheckHooks,
	createPolicyCheck,
} from "./application/policy-check.js";
import {
	createPolicyRequests,
	type PolicyRequests,
} from "./application/policy-requests.js";
import {
	createSkillRuntime,
	NO_SKILL_RUNTIME_ATTESTATIONS,
	type SkillRuntimeAttestations,
} from "./application/skill-runtime.js";
import {
	AUDIT_MIGRATIONS,
	createAuditWriter,
} from "./infrastructure/audit-log.js";
import { maskSecrets } from "./infrastructure/masker.js";
import { policySource, policyStamp } from "./infrastructure/policy-source.js";
import {
	createSkillRuntimeStore,
	SKILL_RUNTIME_MIGRATIONS,
} from "./infrastructure/skill-runtime-store.js";
import { skillWorkspaceKey } from "./infrastructure/skill-workspace-key.js";

/** Folders and OS facts the policy needs; the composition root knows them. */
export type SecurityOptions = {
	readonly workspaceDir: string;
	readonly globalDir: string;
	/** The workspace the policy.blocked events name (docs/07). */
	readonly workspaceId: string;
	readonly home?: string;
	readonly platform?: NodeJS.Platform;
	readonly now?: () => number;
	/** Native skill attestations (ADR-190); omitted means every fresh load fails closed. */
	readonly skills?: SkillRuntimeAttestations;
};

// policy.blocked (docs/07) follows each denial once its audit row is written; a write that throws
// publishes nothing, since the caller then gets audit_failed.
const announcingDenials =
	(
		write: AuditWriter,
		ctx: ModuleContext,
		workspaceId: string,
		now: () => number,
	): AuditWriter =>
	(row) => {
		write(row);
		if (row.verdict !== "deny") return;
		ctx.events.publish({
			id: crypto.randomUUID(),
			ts: new Date(now()).toISOString(),
			schema: 1,
			workspaceId,
			...(row.runId === null ? {} : { runId: row.runId }),
			...(row.agentId === null ? {} : { agentId: row.agentId }),
			source: MANIFEST.id,
			type: "policy.blocked",
			payload: { action: row.action, rule: row.rule },
		});
	};

// policy.asked (ADR-121) follows each ask once its audit row is written, with its time; masking is
// asynchronous and the check is not, so the event may come after the run.paused the ask caused, and
// the module waits for every pending one before it stops, while storage is still active.
const announcingAsks = (
	ctx: ModuleContext,
	workspaceId: string,
	now: () => number,
) => {
	const pending = new Set<Promise<void>>();
	const masked = async (text: string | undefined) =>
		text === undefined ? undefined : (await maskSecrets(text)).text;
	const announce = async (
		input: PolicyCheckInput,
		rule: string,
		ts: string,
	) => {
		const [command, path] = await Promise.all([
			masked(input.command),
			masked(input.path),
		]);
		const { action, capability, adapterId, runId, agentId } = input;
		ctx.events.publish({
			id: crypto.randomUUID(),
			ts,
			schema: 1,
			workspaceId,
			...(runId ? { runId } : {}),
			...(agentId ? { agentId } : {}),
			source: MANIFEST.id,
			type: "policy.asked",
			payload: {
				action,
				capability,
				adapterId,
				rule,
				...(command ? { command } : {}),
				...(path ? { path } : {}),
			},
		});
	};
	return {
		asked(input: PolicyCheckInput, v: { rule: string }) {
			const ts = new Date(now()).toISOString();
			const p: Promise<void> = announce(input, v.rule, ts)
				.catch((e: unknown) =>
					ctx.logger.warn({ error: String(e) }, "policy.asked not published"),
				)
				.finally(() => pending.delete(p));
			pending.add(p);
		},
		settled: async () => {
			await Promise.all([...pending]);
		},
	};
};

const MANIFEST: ModuleManifest = {
	id: "security",
	version: "0.0.0",
	displayName: "Security",
	class: "essential",
	trust: "core",
	provides: [
		"policy.check@1",
		"policy.grant@1",
		"policy.requests@1",
		"secrets.mask@1",
		"skill.runtime@1",
		"skill.selection@1",
	],
	requires: ["storage.sql@1"],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: [],
};

const failed = (message: string): ModuleError => ({
	code: "activation_failed",
	moduleId: MANIFEST.id,
	message,
});

const masker: SecretsMaskAdapter = { mask: maskSecrets };
const requestHooks = (
	requests: PolicyRequests,
	ctx: ModuleContext,
): NonNullable<CheckHooks["requests"]> => ({
	take: requests.take,
	forget: requests.forget,
	remember(input, verdict) {
		const result = requests.remember(input, verdict);
		if (!result.ok)
			ctx.logger.warn(
				{ code: result.error.code },
				"policy request identity not retained",
			);
	},
});

// The policy as it is at each check (ADR-073). `since` is the files' stamp from before the policy was
// read, so an edit during activation is not missed.
const currentPolicy = (
	opts: SecurityOptions,
	ctx: ModuleContext,
	first: Policy,
	since: string,
) =>
	policySource(
		opts,
		first,
		(reason) =>
			ctx.logger.warn(
				{ reason },
				"the policy files changed but do not validate; the last valid policy stays in force",
			),
		since,
	);

// policy.check@1 over the current policy, writing to the workspace audit log.
const checkerOf = (
	opts: SecurityOptions,
	ctx: ModuleContext,
	current: () => Policy,
	db: Parameters<typeof createAuditWriter>[0],
) => {
	const env = () => ({
		policy: current(),
		workspaceDir: opts.workspaceDir,
		globalDir: opts.globalDir,
		home: opts.home ?? homedir(),
		platform: opts.platform ?? process.platform,
	});
	const now = opts.now ?? Date.now;
	const write = announcingDenials(
		createAuditWriter(db),
		ctx,
		opts.workspaceId,
		now,
	);
	const grants = createGrants();
	const requests = createPolicyRequests({
		mask: async (text) => (await maskSecrets(text)).text,
	});
	const asks = announcingAsks(ctx, opts.workspaceId, now);
	const check = createPolicyCheck(env, write, {
		now,
		grants,
		requests: requestHooks(requests, ctx),
		asked: asks.asked,
	});
	const grant: PolicyGrantAdapter = { grant: (input) => grants.grant(input) };
	return { check, grant, requests, settled: asks.settled };
};

/** Lazily binds the canonical workspace; no skill read or scan happens at activation. */
const lazySkillRuntime = (
	opts: SecurityOptions,
	ctx: ModuleContext,
	live: { current: boolean },
): { runtime: SkillRuntimeAdapter; selection: SkillSelectionAdapter } => {
	let built: Promise<ReturnType<typeof createSkillRuntime> | undefined>;
	const build = async () => {
		const storage = ctx.storage;
		if (!storage) return undefined;
		const key = await skillWorkspaceKey(opts.workspaceDir, opts.workspaceId);
		return createSkillRuntime({
			registry: ctx.capabilities,
			masker,
			attestations: opts.skills ?? NO_SKILL_RUNTIME_ATTESTATIONS,
			store: createSkillRuntimeStore(storage.global),
			workspaceKey: key,
			current: () => live.current,
		});
	};
	const get = () => {
		built ??= build().catch(() => undefined);
		return built;
	};
	const unavailable = err({ code: "unavailable" } as const);
	return {
		runtime: {
			inventory: async (i, s) =>
				(await get())?.runtime.inventory(i, s) ?? unavailable,
			catalog: async (s) => (await get())?.runtime.catalog(s) ?? unavailable,
			load: async (i, s) => (await get())?.runtime.load(i, s) ?? unavailable,
			check: async (i, s) => (await get())?.runtime.check(i, s) ?? unavailable,
		},
		selection: {
			check: async (i, s) =>
				(await get())?.selection.check(i, s) ?? unavailable,
		},
	};
};

/** Every security capability for one activation, each a disposable registration. */
const provideAll = (
	ctx: ModuleContext,
	policies: ReturnType<typeof checkerOf>,
	skills: ReturnType<typeof lazySkillRuntime>,
): Disposable[] => {
	const core = { id: MANIFEST.id, trust: "core", features: [] } as const;
	const { requests } = policies;
	return [
		ctx.capabilities.provide("policy.check@1", {
			...core,
			impl: policies.check,
		}),
		ctx.capabilities.provide("policy.grant@1", {
			...core,
			impl: policies.grant,
		}),
		ctx.capabilities.provide("policy.requests@1", {
			...core,
			impl: {
				pending: requests.pending,
				grant: requests.grant,
				forget: requests.forget,
			},
		}),
		ctx.capabilities.provide("secrets.mask@1", { ...core, impl: masker }),
		ctx.capabilities.provide("skill.runtime@1", {
			...core,
			impl: skills.runtime,
		}),
		ctx.capabilities.provide("skill.selection@1", {
			...core,
			impl: skills.selection,
		}),
	];
};

const migrateAll = (ctx: ModuleContext): ModuleError | undefined => {
	if (!ctx.storage) return failed("storage.sql@1 was not provided");
	const audit = ctx.storage.migrate("workspace", AUDIT_MIGRATIONS);
	if (!audit.ok) return failed(audit.error.message);
	const receipts = ctx.storage.migrate("global", SKILL_RUNTIME_MIGRATIONS);
	return receipts.ok ? undefined : failed(receipts.error.message);
};

/** Creates security's policy checks, legacy grants, exact requests and secret masking. */
export const createSecurityModule = (opts: SecurityOptions): MeteModule => {
	let created: Disposable[] = [];
	let settled = async () => {};
	let live = { current: false };
	return {
		manifest: MANIFEST,
		async activate(ctx) {
			const migration = migrateAll(ctx);
			if (migration || !ctx.storage)
				return err(migration ?? failed("storage.sql@1 was not provided"));
			const since = policyStamp(opts);
			const policy = ctx.config.get("policy", PolicySchema);
			if (!policy.ok) {
				const { file, path, reason } = policy.error;
				return err(failed(`${file} ${path}: ${reason}`));
			}
			const current = currentPolicy(opts, ctx, policy.value, since);
			const policies = checkerOf(opts, ctx, current, ctx.storage.workspace);
			settled = policies.settled;
			// A reload gets a fresh lifetime; the retired one stays false forever.
			live = { current: true };
			created = provideAll(ctx, policies, lazySkillRuntime(opts, ctx, live));
			for (const d of created) ctx.disposables.add(d);
			return ok(undefined);
		},
		async deactivate() {
			live.current = false;
			await settled();
			for (const d of created.splice(0)) d.dispose();
		},
	};
};
