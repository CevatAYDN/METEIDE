/** Per-run coordination: human decisions never overwrite an awaited coordinator snapshot. */
export type ControlState = {
	controlTail?: Promise<void> | undefined;
	controlQueued?: number | undefined;
	wakeControl?: (() => void) | undefined;
};

/** Serializes one state-changing scheduler or human-control operation. */
export const runTurn = <T>(
	live: ControlState,
	work: () => T | Promise<T>,
): Promise<T> => {
	const result = (live.controlTail ?? Promise.resolve()).then(work);
	const tail = result.then(
		() => undefined,
		() => undefined,
	);
	live.controlTail = tail;
	void tail.then(() => {
		if (live.controlTail === tail) live.controlTail = undefined;
	});
	return result;
};

/** Queues an exact human decision and wakes a scheduler waiting on worker progress. */
export const controlTurn = <T>(
	live: ControlState,
	work: () => T | Promise<T>,
): Promise<T> => {
	live.controlQueued = (live.controlQueued ?? 0) + 1;
	const result = runTurn(live, async () => {
		try {
			return await work();
		} finally {
			live.controlQueued = (live.controlQueued ?? 1) - 1;
		}
	});
	live.wakeControl?.();
	return result;
};

/** Waits for either worker progress or a queued human decision without polling. */
export const progressOrControl = async (
	live: ControlState,
	progress: Promise<unknown>,
) => {
	if (live.controlQueued) return;
	let wake = () => {};
	const requested = new Promise<void>((resolve) => {
		wake = resolve;
	});
	live.wakeControl = wake;
	try {
		await Promise.race([progress, requested]);
	} finally {
		if (live.wakeControl === wake) live.wakeControl = undefined;
	}
};
