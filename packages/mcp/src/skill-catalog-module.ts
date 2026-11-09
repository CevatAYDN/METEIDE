import {
	type ModuleManifest,
	ok,
	type SkillCatalogAdapter,
} from "@mete/contracts";
import type { Disposable, MeteModule } from "@mete/kernel";
import {
	createSkillCatalog,
	type NativeSkillSources,
} from "./application/skill-catalog.js";

/** Native source attestation and actual catalog handoff to composition. */
export type SkillCatalogOptions = {
	readonly nativeSources: NativeSkillSources;
	readonly onAdapter?: (adapter: SkillCatalogAdapter) => void;
};
const MANIFEST: ModuleManifest = {
	id: "skills-catalog",
	version: "0.0.0",
	displayName: "Skill catalog",
	class: "optional",
	trust: "core",
	provides: ["skill.catalog@1"],
	requires: ["skill.source@1"],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: [],
};

/** Register management only; activation does not scan, connect or load skills. */
export const createSkillCatalogModule = (
	opts: SkillCatalogOptions,
): MeteModule => {
	let registration: Disposable | undefined;
	return {
		manifest: MANIFEST,
		activate(ctx) {
			const impl = createSkillCatalog(ctx.capabilities, opts.nativeSources);
			registration = ctx.capabilities.provide("skill.catalog@1", {
				id: "skills-catalog",
				trust: "core",
				features: [],
				impl,
			});
			ctx.disposables.add(registration);
			opts.onAdapter?.(impl);
			return Promise.resolve(ok(undefined));
		},
		deactivate() {
			registration?.dispose();
			registration = undefined;
			return Promise.resolve();
		},
	};
};
