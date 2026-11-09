import {
	err,
	IdSchema,
	type ModuleManifest,
	ok,
	type Result,
	type SkillCatalogAdapter,
	type SkillSourceAdapter,
	type SkillTrustAdapter,
} from "@mete/contracts";
import type {
	Disposable,
	MeteModule,
	ModuleContext,
	ModuleError,
} from "@mete/kernel";
import type { SkillAdmission } from "./application/skill-mutation.js";
import { createSkillTrustAdapter } from "./application/skill-trust.js";
import {
	createSkillTrustStore,
	SKILL_TRUST_MIGRATIONS,
} from "./infrastructure/skill-trust-store.js";
import { skillWorkspaceKey } from "./infrastructure/skill-workspace-key.js";

/** Native composition supplies roots, attestations and an irreversible admission receipt. */
export type SkillTrustOptions = {
	readonly workspaceDir: string;
	readonly workspaceId: string;
	readonly nativeSources: WeakSet<SkillSourceAdapter>;
	readonly nativeCatalogs: WeakSet<SkillCatalogAdapter>;
	readonly admit: (signal: AbortSignal) => Promise<SkillAdmission>;
	readonly onAdapter?: (adapter: SkillTrustAdapter) => void;
	readonly now?: () => number;
};
const MANIFEST: ModuleManifest = {
	id: "skills-trust",
	version: "0.0.0",
	displayName: "Skill trust",
	class: "optional",
	trust: "core",
	provides: ["skill.trust@1"],
	requires: [
		"storage.sql@1",
		"skill.source@1",
		"skill.catalog@1",
		"secrets.mask@1",
	],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: [],
};
type Controller = ReturnType<typeof createSkillTrustAdapter>;
const failed = (): Result<never, ModuleError> =>
	err({
		code: "activation_failed",
		moduleId: MANIFEST.id,
		message: "skill trust activation failed",
	});
const start = async (
	opts: SkillTrustOptions,
	ctx: ModuleContext,
): Promise<Result<Controller, ModuleError>> => {
	try {
		if (!ctx.storage || !IdSchema.safeParse(opts.workspaceId).success)
			return failed();
		const workspaceKey = await skillWorkspaceKey(
			opts.workspaceDir,
			opts.workspaceId,
		);
		const migrated = ctx.storage.migrate("global", SKILL_TRUST_MIGRATIONS);
		if (!migrated.ok) return failed();
		const store = createSkillTrustStore(ctx.storage.global);
		return ok(
			createSkillTrustAdapter({
				...opts,
				registry: ctx.capabilities,
				grants: {
					list: () => store.list(workspaceKey),
					read: (sourceId) => store.read(workspaceKey, sourceId),
				},
				update: (input) => store.update({ workspaceKey, ...input }),
			}),
		);
	} catch {
		return failed();
	}
};

/** Optional management-only module; global receipt writes never enter essential security activation. */
export const createSkillTrustModule = (opts: SkillTrustOptions): MeteModule => {
	let controller: Controller | undefined;
	let registration: Disposable | undefined;
	const stop = async () => {
		const retiring = controller;
		controller = undefined;
		registration?.dispose();
		registration = undefined;
		await retiring?.close();
	};
	return {
		manifest: MANIFEST,
		async activate(ctx) {
			if (controller) return failed();
			const started = await start(opts, ctx);
			if (!started.ok) return started;
			controller = started.value;
			try {
				registration = ctx.capabilities.provide("skill.trust@1", {
					id: MANIFEST.id,
					trust: MANIFEST.trust,
					features: [],
					impl: controller.impl,
				});
				ctx.disposables.add(registration);
				opts.onAdapter?.(controller.impl);
				return ok(undefined);
			} catch {
				await stop();
				return failed();
			}
		},
		deactivate: stop,
	};
};
