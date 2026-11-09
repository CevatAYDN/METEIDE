import {
	type ModuleManifest,
	ok,
	type SkillSourceAdapter,
} from "@mete/contracts";
import type { Disposable, MeteModule, ModuleContext } from "@mete/kernel";
import { readSkillSource } from "./infrastructure/skill-reader.js";
import { createSkillSourceLookup } from "./infrastructure/skill-source-lookup.js";

/** Native roots and composition-owned attestation of the exact registered adapter. */
export type SkillSourceOptions = {
	readonly workspaceDir: string;
	readonly globalDir: string;
	readonly onAdapter?: (adapter: SkillSourceAdapter) => void;
};

const MANIFEST: ModuleManifest = {
	id: "tools-skill-source",
	version: "0.0.0",
	displayName: "Skill sources",
	class: "optional",
	trust: "core",
	provides: ["skill.source@1"],
	requires: [],
	optional: [],
	activation: ["onStartup"],
	isolation: "in-process",
	permissions: ["fs.read"],
};

const registerSource = (
	opts: SkillSourceOptions,
	ctx: ModuleContext,
): Disposable => {
	const lifetime = new AbortController();
	const lookup = createSkillSourceLookup(opts);
	const current = (signal: AbortSignal) =>
		AbortSignal.any([signal, lifetime.signal]);
	const impl: SkillSourceAdapter = {
		list: (signal) => lookup.list(current(signal)),
		read: (input, signal) =>
			readSkillSource(
				{ ...opts, locate: lookup.locate },
				input,
				current(signal),
			),
	};
	const registration = ctx.capabilities.provide("skill.source@1", {
		id: MANIFEST.id,
		trust: MANIFEST.trust,
		features: [],
		impl,
	});
	opts.onAdapter?.(impl);
	return {
		dispose() {
			if (lifetime.signal.aborted) return;
			lifetime.abort();
			lookup.clear();
			registration.dispose();
		},
	};
};

/** Optional management-only source port; activation registers but never scans roots. */
export const createSkillSourceModule = (
	opts: SkillSourceOptions,
): MeteModule => {
	let active: Disposable | undefined;
	return {
		manifest: MANIFEST,
		async activate(ctx) {
			active?.dispose();
			active = registerSource(opts, ctx);
			ctx.disposables.add(active);
			return ok(undefined);
		},
		async deactivate() {
			active?.dispose();
			active = undefined;
		},
	};
};
