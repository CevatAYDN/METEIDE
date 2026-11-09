import type { RunSkillsReadResult } from "@mete/contracts";
import type { MeteDaemonService } from "../domain/status-service.js";
import type { Shown } from "./board-session.js";

type Fetch = MeteDaemonService["runSkillsRead"] | undefined;
type Summary = Extract<RunSkillsReadResult, { kind: "summary" | "legacy" }>;
type Detail = Extract<RunSkillsReadResult, { kind: "context" }>;

/** A failed read is never shown as a run without skills (docs: skill activation, U3). */
export type RunSkillsState = {
	readonly phase: "idle" | "loading" | "ready" | "failed";
	readonly result?: Summary | undefined;
	readonly detail?: Detail | undefined;
	readonly detailFailed?: string | undefined;
};

const read = async (
	fetch: Fetch,
	shown: Shown,
	contextId?: string,
): Promise<RunSkillsReadResult | undefined> => {
	try {
		const input = contextId
			? { runId: shown.runId, contextId }
			: { runId: shown.runId };
		const r = await fetch?.(shown.dir, input);
		return r?.ok && r.value.ok && r.value.value.runId === shown.runId
			? r.value.value
			: undefined;
	} catch {
		return undefined;
	}
};

const withDetail = (
	state: RunSkillsState,
	r: RunSkillsReadResult | undefined,
	contextId: string,
): RunSkillsState =>
	r?.kind === "context" && r.context.owner.contextId === contextId
		? { ...state, detail: r, detailFailed: undefined }
		: { ...state, detail: undefined, detailFailed: contextId };

/** Metadata summary per shown run; bounded bodies only for one expanded context. */
export const createRunSkills = (deps: {
	readonly fetch: () => Fetch;
	readonly shown: () => Shown | undefined;
	readonly onChange: () => void;
}) => {
	let target: Shown | undefined;
	let generation = 0;
	let state: RunSkillsState = { phase: "idle" };
	const set = (next: RunSkillsState) => {
		state = next;
		deps.onChange();
	};
	const live = (asked: number, shown: Shown) =>
		asked === generation && target === shown && deps.shown() === shown;
	const refresh = async () => {
		const shown = target;
		if (!shown || deps.shown() !== shown) return;
		const asked = ++generation;
		set({ phase: "loading" });
		const r = await read(deps.fetch(), shown);
		if (!live(asked, shown)) return;
		set(
			r && r.kind !== "context"
				? { phase: "ready", result: r }
				: { phase: "failed" },
		);
	};
	const expand = async (contextId: string) => {
		const shown = target;
		if (!shown || state.phase !== "ready") return;
		const asked = generation;
		const r = await read(deps.fetch(), shown, contextId);
		if (!live(asked, shown)) return;
		set(withDetail(state, r, contextId));
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
		expand,
		clear: () => {
			generation++;
			target = undefined;
			set({ phase: "idle" });
		},
	};
};
