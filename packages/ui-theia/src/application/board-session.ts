import type { MeteEvent, Result } from "@mete/contracts";
import { applyAll, EMPTY_TEAM_VIEW, type TeamView } from "@mete/ui-studio";
import type { DaemonFailure } from "../domain/status-service.js";
import type { BoardModel } from "./board-view.js";

// What the Board panel knows about the run it shows (ADR-051), as pure steps the widget calls. The
// order matters: the fold records an event id even when the event changed nothing, so a status
// change applied before its task.created would be lost for good. So a session listens first and
// buffers the run's live events, then folds the history, then the buffer, and only then folds live
// events as they come; the fold skips the ones the history had.

/** The run the Board shows. */
export type Shown = {
	readonly dir: string;
	readonly runId: string;
	readonly goal: string;
};

/** The Board's state: the run, its folded view, and the live events held while its history is read. */
export type BoardSession = {
	readonly shown?: Shown;
	readonly view: TeamView;
	readonly unreadable: number;
	readonly buffer?: readonly MeteEvent[];
	readonly model: BoardModel;
};

/** No run chosen yet. */
export const IDLE_BOARD: BoardSession = {
	view: EMPTY_TEAM_VIEW,
	unreadable: 0,
	model: { kind: "no_run" },
};

/** A run was chosen: its live events wait in the buffer until its history is folded. */
export const startBoard = (shown: Shown): BoardSession => ({
	shown,
	view: EMPTY_TEAM_VIEW,
	unreadable: 0,
	buffer: [],
	model: { kind: "loading" },
});

const drawn = (s: BoardSession, shown: Shown, view: TeamView): BoardModel => ({
	kind: "board",
	goal: shown.goal,
	view,
	unreadable: s.unreadable,
});

/** A live event of a folder's daemon; one the fold does not take, or already folded, changes nothing. */
export const receiveBoard = (
	s: BoardSession,
	dir: string,
	e: MeteEvent,
): BoardSession => {
	const shown = s.shown;
	// The fold decides which events are the run's: its own, and the workspace's quota events,
	// which name no run (ADR-052).
	if (!shown || dir !== shown.dir) return s;
	if (s.buffer) return { ...s, buffer: [...s.buffer, e] };
	const view = applyAll(shown.runId, s.view, [e]);
	if (view === s.view) return s;
	const model = s.model.kind === "board" ? drawn(s, shown, view) : s.model;
	return { ...s, view, model };
};

/** The history of `shown` arrived; an answer for a run no longer shown changes nothing. */
export const loadedBoard = (
	s: BoardSession,
	shown: Shown,
	r: Result<
		{ readonly events: readonly MeteEvent[]; readonly unreadable: number },
		DaemonFailure
	>,
): BoardSession => {
	if (s.shown !== shown) return s;
	const { buffer: live = [], ...rest } = s;
	if (!r.ok) return { ...rest, model: { kind: "failed", failure: r.error } };
	const history = applyAll(shown.runId, EMPTY_TEAM_VIEW, r.value.events);
	const view = applyAll(shown.runId, history, live);
	const next = { ...rest, view, unreadable: r.value.unreadable };
	return { ...next, model: drawn(next, shown, view) };
};
