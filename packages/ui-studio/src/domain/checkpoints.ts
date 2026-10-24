import type { MeteEvent } from "@mete/contracts";

// A run's checkpoints for the Team panel's list (ADR-079): each checkpoint.created, by the number its
// ref ends in and its time, marked when rollback.performed names it. No event names a checkpoint's
// step, so the list shows none (docs/07's stepId stays unfilled).

/** One checkpoint as the Team panel lists it. */
export type CheckpointCard = {
	/** The id of its checkpoint.created event, which mete/checkpoint.restore takes. */
	readonly id: string;
	readonly ref: string;
	/** The number its ref ends in: refs/mete/checkpoints/<run id>/<n>. */
	readonly n: number;
	readonly at: string;
	/** When it was last restored. */
	readonly restoredAt?: string;
};

const numberOf = (ref: string) => Number(ref.slice(ref.lastIndexOf("/") + 1));

/** The checkpoints after one event of their run. */
export const checkpointsAfter = (
	list: readonly CheckpointCard[],
	e: MeteEvent,
): readonly CheckpointCard[] => {
	if (e.type === "checkpoint.created")
		return [
			...list,
			{ id: e.id, ref: e.payload.ref, n: numberOf(e.payload.ref), at: e.ts },
		];
	if (e.type === "rollback.performed")
		return list.map((c) =>
			c.id === e.payload.checkpointId ? { ...c, restoredAt: e.ts } : c,
		);
	return list;
};
