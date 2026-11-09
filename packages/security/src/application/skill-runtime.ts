import {
	err,
	type SecretsMaskAdapter,
	type SkillCatalogAdapter,
	type SkillRuntimeAdapter,
	SkillRuntimeInventoryInputSchema,
	type SkillSelectionAdapter,
	type SkillSourceAdapter,
	type SkillTrustAdapter,
} from "@mete/contracts";
import type { CapabilityRegistry } from "@mete/kernel";
import { checkSkillSnapshots } from "./skill-check.js";
import { loadSkillVersion, type SkillLoadAdmission } from "./skill-load.js";
import { readSkillRuntimeCatalog } from "./skill-runtime-catalog.js";
import { lifetimeCurrent } from "./skill-runtime-evidence.js";
import type { SkillRuntimeReaderOptions } from "./skill-runtime-readers.js";
import { checkSkillSelection } from "./skill-selection.js";

/** Native composition attestations; absent ones make every content operation fail closed. */
export type SkillRuntimeAttestations = {
	readonly nativeSources: WeakSet<SkillSourceAdapter>;
	readonly nativeCatalogs: WeakSet<SkillCatalogAdapter>;
	readonly nativeTrust: Pick<WeakSet<SkillTrustAdapter>, "has">;
	readonly admission: SkillLoadAdmission;
};
/** Receipt storage bound to one canonical workspace. */
export type SkillRuntimeStore = Parameters<
	typeof loadSkillVersion
>[0]["store"] &
	Parameters<typeof checkSkillSnapshots>[0]["store"];
type RuntimeDeps = {
	readonly registry: CapabilityRegistry;
	readonly masker: SecretsMaskAdapter;
	readonly attestations: SkillRuntimeAttestations;
	readonly store: SkillRuntimeStore;
	readonly workspaceKey: string;
	readonly current: () => boolean;
};

/** Refuses every fresh load; used when composition supplies no native admission. */
export const NO_SKILL_RUNTIME_ATTESTATIONS: SkillRuntimeAttestations = {
	nativeSources: new WeakSet(),
	nativeCatalogs: new WeakSet(),
	nativeTrust: new WeakSet(),
	admission: { live: () => false, fits: () => false },
};

/** skill.runtime@1 and skill.selection@1 over one captured composition (ADR-190/191). */
export const createSkillRuntime = (deps: RuntimeDeps) => {
	const { attestations, store, workspaceKey } = deps;
	const readers: SkillRuntimeReaderOptions = {
		registry: deps.registry,
		nativeSources: attestations.nativeSources,
		nativeCatalogs: attestations.nativeCatalogs,
		nativeTrust: attestations.nativeTrust,
		nativeMaskers: new WeakSet([deps.masker]),
		current: deps.current,
	};
	const runtime: SkillRuntimeAdapter = {
		inventory: async (input, signal) => {
			if (signal.aborted) return err({ code: "aborted" });
			if (!lifetimeCurrent(deps.current)) return err({ code: "stale" });
			const parsed = SkillRuntimeInventoryInputSchema.safeParse(input);
			if (!parsed.success) return err({ code: "bad_input" });
			return store.inventory(workspaceKey, parsed.data.runId);
		},
		catalog: (signal) => readSkillRuntimeCatalog(readers, signal),
		load: (input, signal) =>
			loadSkillVersion(
				{ ...readers, admission: attestations.admission, store, workspaceKey },
				input,
				signal,
			),
		check: (input, signal) =>
			checkSkillSnapshots({ ...readers, store, workspaceKey }, input, signal),
	};
	const selection: SkillSelectionAdapter = {
		check: (input, signal) => checkSkillSelection(readers, input, signal),
	};
	return { runtime, selection };
};
