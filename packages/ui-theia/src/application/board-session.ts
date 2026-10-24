import type { MeteEvent, Result } from "@mete/contracts";
import { applyAll, EMPTY_TEAM_VIEW, type TeamView } from "@mete/ui-studio";
import { FEED_EVENTS, STUDIO_RECENT_EVENTS } from "../defaults.js";
import type { DaemonFailure } from "../domain/status-service.js";
import type { BoardModel } from "./board-view.js";
import { inFeed } from "./feed-rows.js";

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
	/** The run's latest events of tab 13's studio table, for the Studio's accessible list. */
	readonly recent: readonly MeteEvent[];
	/** The run's latest events of the Team view's Activity feed (ADR-092). */
	readonly feed: readonly MeteEvent[];
	/** The last live event the fold took and the view before it: what the Studio animates. */
	readonly pulse?: Pulse;
	readonly model: BoardModel;
};

/** A live event and the view before it; history and the buffer make none (ADR-052). */
export type Pulse = { readonly event: MeteEvent; readonly before: TeamView };

/** No run chosen yet. */
export const IDLE_BOARD: BoardSession = {
	view: EMPTY_TEAM_VIEW,
	unreadable: 0,
	recent: [],
	feed: [],
	model: { kind: "no_run" },
};

/** A run was chosen: its live events wait in the buffer until its history is folded. */
export const startBoard = (shown: Shown): BoardSession => ({
	shown,
	view: EMPTY_TEAM_VIEW,
	unreadable: 0,
	buffer: [],
	recent: [],
	feed: [],
	model: { kind: "loading" },
});

// The events docs/13's studio table draws; each gets a line in the Studio's accessible list.
const STUDIO_EVENTS = new Set<string>([
	"task.created",
	"task.assigned",
	"task.status.changed",
	"agent.thinking.started",
	"agent.tool.called",
	"agent.message.sent",
	"review.requested",
	"quota.exhausted",
	"quota.restored",
	"run.paused",
	"approval.requested",
	"vault.note.saved",
	"run.completed",
]);

// The latest events a list keeps, each once; the same list when none is added.
const keptAfter = (
	kept: readonly MeteEvent[],
	events: readonly MeteEvent[],
	keep: (e: MeteEvent) => boolean,
	most: number,
) => {
	const added = events.filter(
		(e) => keep(e) && !kept.some((x) => x.id === e.id),
	);
	return added.length === 0 ? kept : [...kept, ...added].slice(-most);
};

// The events of the run (or of its workspace's quota) the studio table names.
const recentAfter = (
	recent: readonly MeteEvent[],
	runId: string,
	events: readonly MeteEvent[],
) =>
	keptAfter(
		recent,
		events,
		(e) =>
			(e.runId === runId || (!e.runId && e.type.startsWith("quota."))) &&
			STUDIO_EVENTS.has(e.type),
		STUDIO_RECENT_EVENTS,
	);

// The run's events the Activity feed shows (ADR-092).
const feedAfter = (
	feed: readonly MeteEvent[],
	runId: string,
	events: readonly MeteEvent[],
) =>
	keptAfter(feed, events, (e) => e.runId === runId && inFeed(e), FEED_EVENTS);

const drawn = (s: BoardSession, shown: Shown, view: TeamView): BoardModel => ({
	kind: "board",
	goal: shown.goal,
	view,
	unreadable: s.unreadable,
	recent: s.recent,
	feed: s.feed,
	...(s.pulse ? { pulse: s.pulse } : {}),
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
	const recent = recentAfter(s.recent, shown.runId, [e]);
	const feed = feedAfter(s.feed, shown.runId, [e]);
	if (view === s.view && recent === s.recent && feed === s.feed) return s;
	const next = {
		...s,
		view,
		recent,
		feed,
		pulse: { event: e, before: s.view },
	};
	const model = s.model.kind === "board" ? drawn(next, shown, view) : s.model;
	return { ...next, model };
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
	const all = [...r.value.events, ...live];
	const recent = recentAfter([], shown.runId, all);
	const feed = feedAfter([], shown.runId, all);
	const next = { ...rest, view, recent, feed, unreadable: r.value.unreadable };
	return { ...next, model: drawn(next, shown, view) };
};
