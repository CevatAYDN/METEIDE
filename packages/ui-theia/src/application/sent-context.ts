import type { ThreadContextReadResult } from "@mete/contracts";
import type { MeteDaemonService } from "../domain/status-service.js";
import type { Shown } from "./board-session.js";

/** Context read failures never masquerade as a turn with no attachments. */
export type SentContextState = {
	readonly phase: "idle" | "loading" | "ready" | "failed";
	readonly result?: ThreadContextReadResult | undefined;
};

/** Immutable copies use semantic identity plus occurrence to preserve exact duplicates. */
export const sentContextEntries = (result: ThreadContextReadResult) => {
	const occurrences = new Map<string, number>();
	return result.attachments.map((snapshot) => {
		const identity = JSON.stringify([
			result.runId,
			snapshot.path,
			snapshot.range ?? null,
			snapshot.modified,
			snapshot.sha256,
		]);
		const occurrence = occurrences.get(identity) ?? 0;
		occurrences.set(identity, occurrence + 1);
		return { key: JSON.stringify([identity, occurrence]), snapshot };
	});
};

const readContext = async (
	fetch: () => MeteDaemonService["threadContextRead"] | undefined,
	shown: Shown,
): Promise<SentContextState> => {
	try {
		const result = await fetch()?.(shown.dir, { runId: shown.runId });
		return result?.ok && result.value.runId === shown.runId
			? { phase: "ready", result: result.value }
			: { phase: "failed" };
	} catch {
		return { phase: "failed" };
	}
};

/** Reads only the explicitly selected immutable run, dropping late navigation results. */
export const createSentContext = (deps: {
	readonly fetch: () => MeteDaemonService["threadContextRead"] | undefined;
	readonly shown: () => Shown | undefined;
	readonly onChange: () => void;
}) => {
	let target: Shown | undefined;
	let generation = 0;
	let state: SentContextState = { phase: "idle" };
	const set = (next: SentContextState) => {
		state = next;
		deps.onChange();
	};
	const refresh = async () => {
		const shown = target;
		if (!shown || deps.shown() !== shown) return;
		const asked = ++generation;
		set({ phase: "loading" });
		const next = await readContext(deps.fetch, shown);
		if (asked === generation && deps.shown() === shown) set(next);
	};
	return {
		get state() {
			return state;
		},
		show: (shown: Shown) => {
			target = shown;
			return refresh();
		},
		refresh,
		clear: () => {
			generation++;
			target = undefined;
			set({ phase: "idle" });
		},
	};
};
