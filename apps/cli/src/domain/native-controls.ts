import type { RunQuiesceAdapter, TeamEngineV3Adapter } from "@mete/contracts";

/** The exact native pair supplied by one core activation (ADR-190). */
export type NativeControls = {
	readonly engine: TeamEngineV3Adapter;
	readonly quiesce: RunQuiesceAdapter;
};

/** Admission may check the current pair, but cannot attest another one. */
export type NativeControlsView = {
	readonly has: (
		engine: TeamEngineV3Adapter,
		quiesce: RunQuiesceAdapter,
	) => boolean;
};

/** One workspace's latest activation replaces, rather than accumulates, authority. */
export const createNativeControls = () => {
	let current: NativeControls | undefined;
	return {
		onNativeControls: (controls: NativeControls) => {
			current = { engine: controls.engine, quiesce: controls.quiesce };
		},
		view: Object.freeze({
			has: (engine: TeamEngineV3Adapter, quiesce: RunQuiesceAdapter) =>
				current?.engine === engine && current.quiesce === quiesce,
		}),
	};
};
