import type { ChatChunk, ProviderError } from "@mete/contracts";

// A provider call that goes quiet (docs/09, Stalls; ADR-062): no first chunk within `firstMs`, or no
// chunk for `gapMs` after one, aborts the call and ends it with a `network` error chunk, which the
// gateway handles like a dropped connection.

/** How long a provider call may stay quiet, in milliseconds. */
export type StallLimits = { readonly firstMs: number; readonly gapMs: number };

const QUIET = "the model sent nothing for";

const quiet = (ms: number): ChatChunk => ({
	type: "error",
	error: { code: "network", message: `${QUIET} ${ms / 1000} s` },
});

// shortcut: a stall is told from a dropped connection by its message, since ProviderError has no
// field for it; give the contract one when a second caller needs to know.
/** A network error that is a stall of ADR-062, not a dropped connection. */
export const isStall = (e: ProviderError) =>
	e.code === "network" && e.message.startsWith(QUIET);

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
