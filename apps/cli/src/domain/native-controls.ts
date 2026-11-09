import type {
	RunQuiesceAdapter,
	SkillRuntimeLoadInput,
	TeamEngineV3Adapter,
} from "@mete/contracts";

/** The process-local skill load authority one core activation supplies (ADR-190/194). */
export type NativeSkillLoads = {
	readonly live: (input: SkillRuntimeLoadInput) => boolean;
	readonly fits: (input: SkillRuntimeLoadInput, maskedBytes: number) => boolean;
};

/** The exact native pair supplied by one core activation (ADR-190). */
export type NativeControls = {
	readonly engine: TeamEngineV3Adapter;
	readonly quiesce: RunQuiesceAdapter;
	readonly skillLoads?: NativeSkillLoads;
};

/** Admission may check the current pair, but cannot attest another one. */
export type NativeControlsView = {
	readonly has: (
		engine: TeamEngineV3Adapter,
		quiesce: RunQuiesceAdapter,
	) => boolean;
};

/** Refuses every fresh load until a core activation supplies its authority. */
const closed: NativeSkillLoads = { live: () => false, fits: () => false };

/** One workspace's latest activation replaces, rather than accumulates, authority. */
export const createNativeControls = () => {
	let current: NativeControls | undefined;
	return {
		onNativeControls: (controls: NativeControls) => {
			current = {
				engine: controls.engine,
				quiesce: controls.quiesce,
				...(controls.skillLoads ? { skillLoads: controls.skillLoads } : {}),
			};
		},
		view: Object.freeze({
			has: (engine: TeamEngineV3Adapter, quiesce: RunQuiesceAdapter) =>
				current?.engine === engine && current.quiesce === quiesce,
		}),
		/**
		 * Security's load admission always delegates to the latest activation, so a reloaded
		 * core retires the previous authority instead of keeping it alive.
		 */
		skillLoads: Object.freeze<NativeSkillLoads>({
			live: (input) => (current?.skillLoads ?? closed).live(input),
			fits: (input, bytes) =>
				(current?.skillLoads ?? closed).fits(input, bytes),
		}),
	};
};
