import type { ChatChunk } from "@mete/contracts";

// A provider call that goes quiet (docs/09, Stalls; ADR-062): no first chunk within `firstMs`, or no
// chunk for `gapMs` after one, aborts the call and ends it with a `network` error chunk, which the
// gateway handles like a dropped connection.

/** How long a provider call may stay quiet, in milliseconds. */
export type StallLimits = { readonly firstMs: number; readonly gapMs: number };

const quiet = (ms: number): ChatChunk => ({
	type: "error",
	error: {
		code: "network",
		message: `the model sent nothing for ${ms / 1000} s`,
	},
});

/** The chunks of the stream `open` starts, ended with a network error when it stays quiet too long. */
export async function* watched(
	open: (signal: AbortSignal) => AsyncIterable<ChatChunk>,
	signal: AbortSignal,
	limits: StallLimits,
): AsyncGenerator<ChatChunk> {
	const stop = new AbortController();
	const it = open(AbortSignal.any([signal, stop.signal]))[
		Symbol.asyncIterator
	]();
	let wait = limits.firstMs;
	try {
		for (;;) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const late = new Promise<"late">((r) => {
				timer = setTimeout(() => r("late"), wait);
			});
			const next = await Promise.race([it.next(), late]);
			clearTimeout(timer);
			if (next === "late") {
				stop.abort();
				yield quiet(wait);
				return;
			}
			if (next.done) return;
			yield next.value;
			wait = limits.gapMs;
		}
	} finally {
		// Not awaited: a stream stuck in next() may never answer return().
		void it.return?.();
	}
}
