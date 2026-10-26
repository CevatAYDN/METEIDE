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
	createPolicyCheck,
} from "./application/policy-check.js";
import {
	AUDIT_MIGRATIONS,
	createAuditWriter,
} from "./infrastructure/audit-log.js";
import { maskSecrets } from "./infrastructure/masker.js";
import { policySource, policyStamp } from "./infrastructure/policy-source.js";

/** Folders and OS facts the policy needs; the composition root knows them. */
export type SecurityOptions = {
	readonly workspaceDir: string;
	readonly globalDir: string;
	/** The workspace the policy.blocked events name (docs/07). */
	readonly workspaceId: string;
	readonly home?: string;
	readonly platform?: NodeJS.Platform;
	readonly now?: () => number;
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
	provides: ["policy.check@1", "policy.grant@1", "secrets.mask@1"],
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
	const asks = announcingAsks(ctx, opts.workspaceId, now);
	const check = createPolicyCheck(env, write, {
		now,
		grants,
		asked: asks.asked,
	});
	const grant: PolicyGrantAdapter = { grant: (input) => grants.grant(input) };
	return { check, grant, settled: asks.settled };
};

/** Creates the security module, which provides policy.check@1, policy.grant@1 and secrets.mask@1. */
export const createSecurityModule = (opts: SecurityOptions): MeteModule => {
	let created: Disposable[] = [];
	let settled = async () => {};
	return {
		manifest: MANIFEST,
		async activate(ctx) {
			if (!ctx.storage) return err(failed("storage.sql@1 was not provided"));
			const migrated = ctx.storage.migrate("workspace", AUDIT_MIGRATIONS);
			if (!migrated.ok) return err(failed(migrated.error.message));
			const since = policyStamp(opts);
			const policy = ctx.config.get("policy", PolicySchema);
			if (!policy.ok) {
				const { file, path, reason } = policy.error;
				return err(failed(`${file} ${path}: ${reason}`));
			}
			const current = currentPolicy(opts, ctx, policy.value, since);
			const policies = checkerOf(opts, ctx, current, ctx.storage.workspace);
			settled = policies.settled;
			const core = { id: MANIFEST.id, trust: "core", features: [] } as const;
			created = [
				ctx.capabilities.provide("policy.check@1", {
					...core,
					impl: policies.check,
				}),
				ctx.capabilities.provide("policy.grant@1", {
					...core,
					impl: policies.grant,
				}),
				ctx.capabilities.provide("secrets.mask@1", { ...core, impl: masker }),
			];
			for (const d of created) ctx.disposables.add(d);
			return ok(undefined);
		},
		async deactivate() {
			await settled();
			for (const d of created.splice(0)) d.dispose();
		},
	};
};
