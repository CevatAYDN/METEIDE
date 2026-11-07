import { err, type ThreadReadResult } from "@mete/contracts";
import type {
	DaemonFailure,
	MeteDaemonService,
} from "../domain/status-service.js";
import type { Shown } from "./board-session.js";

/** History is reply authority only after a successful read of this exact selection (ADR-182). */
export type ThreadHistoryState = {
	readonly phase: "idle" | "loading" | "ready" | "failed";
	readonly result?: ThreadReadResult | undefined;
	readonly failure?: DaemonFailure | undefined;
};

const read = async (fetch: MeteDaemonService["threadRead"], shown: Shown) => {
	try {
		return await fetch(shown.dir, { runId: shown.runId });
	} catch {
		return err({ code: "stopped" as const, detail: "" });
	}
};

type Deps = {
	readonly fetch: MeteDaemonService["threadRead"];
	readonly shown: () => Shown | undefined;
	readonly onChange: (state: ThreadHistoryState) => void;
};

/** Resolve immutable run history without changing which run the user chose to inspect. */
export const createThreadHistory = (deps: Deps) => {
	let generation = 0;
	let target: Shown | undefined;
	let state: ThreadHistoryState = { phase: "idle" };
	const set = (next: ThreadHistoryState) => {
		state = next;
		deps.onChange(state);
	};
	const load = async (): Promise<void> => {
		const shown = target;
		if (!shown || deps.shown() !== shown) return;
		const asked = ++generation;
		set({ phase: "loading" });
		const result = await read(deps.fetch, shown);
		if (asked !== generation || deps.shown() !== shown) return;
		set(
			result.ok
				? { phase: "ready", result: result.value }
				: { phase: "failed", failure: result.error },
		);
	};
	return {
		get state() {
			return state;
		},
		show: (shown: Shown) => {
			target = shown;
			return load();
		},
		refresh: load,
		clear: () => {
			generation++;
			target = undefined;
			set({ phase: "idle" });
		},
	};
};
