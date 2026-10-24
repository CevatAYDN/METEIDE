import type { MeteEvent } from "@mete/contracts";
import {
	type Place,
	placeOf,
	type TaskCard,
	type TeamView,
} from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties, ReactNode } from "react";
import { rosterOf } from "../domain/roster.js";
import type { DaemonFailure } from "../domain/status-service.js";
import { CheckpointList, type RestoreControls } from "./checkpoint-list.js";
import type { Windows } from "./context-meter.js";
import { LINK, LIST, MUTED, PANEL, TITLE } from "./look.js";
import { openReportLabel, ResultsList, reportPath } from "./results-list.js";
import { failureText } from "./status-text.js";
import { studioText } from "./studio-text.js";
import { TeamView as Roster } from "./team-view.js";
import { type WaitingControls, WaitingStrip } from "./waiting-strip.js";

// The Team panel (docs/13, ADR-051): one run's tasks on the Board (To do, In progress and Done),
// its members in the Team view (ADR-089) or as the Flow graph, both from the view model the fold of @mete/ui-studio keeps. Text is shown as it is: React escapes it.
// Inline styles on Theia's CSS variables, as the Home view: the DOM panels keep Theia's colours (ADR-052).

/** What the Board draws: no run chosen yet, waiting for the history, why it failed, or the run. */
export type BoardModel =
	| { readonly kind: "no_run" }
	| { readonly kind: "loading" }
	| { readonly kind: "failed"; readonly failure: DaemonFailure }
	| {
			readonly kind: "board";
			readonly goal: string;
			readonly view: TeamView;
			readonly unreadable: number;
			/** The run's latest studio events, for the Studio's accessible list. */
			readonly recent: readonly MeteEvent[];
			/** The last live event and the view before it, for the Studio's effects. */
			readonly pulse?: { readonly event: MeteEvent; readonly before: TeamView };
	  };

// The Board fills the panel; its columns share the width.
const BOARD: CSSProperties = {
	...PANEL,
	height: "100%",
	boxSizing: "border-box",
};
const COLUMNS: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
	gap: "12px",
};
const CARD: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "2px",
	padding: "8px 12px",
};

const columnName = (column: Place["column"]) =>
	({
		todo: nls.localize("mete/board/todo", "To do"),
		in_progress: nls.localize("mete/board/inProgress", "In progress"),
		done: nls.localize("mete/board/done", "Done"),
	})[column];

const markerText = (marker: NonNullable<Place["marker"]>) =>
	({
		in_review: nls.localize("mete/board/inReview", "In review"),
		changes_asked: nls.localize("mete/board/changesAsked", "Changes asked"),
		blocked: nls.localize("mete/board/blocked", "Blocked"),
	})[marker];

// A Done card opens its report; another column's report may still change (ADR-085).
const Card = ({
	task,
	onOpen,
}: {
	readonly task: TaskCard;
	readonly onOpen: (path: string) => void;
}) => {
	const { column, marker } = placeOf(task.status);
	const path = column === "done" ? reportPath(task) : undefined;
	return (
		<li className="mete-card" style={CARD}>
			<span>{task.title}</span>
			<span style={MUTED}>
				{task.roleId}
				{marker ? ` · ${markerText(marker)}` : ""}
			</span>
			{path ? (
				<button
					type="button"
					style={LINK}
					aria-label={openReportLabel(task)}
					onClick={() => onOpen(path)}
				>
					{nls.localize("mete/board/openReport", "Open report")}
				</button>
			) : null}
		</li>
	);
};

const Column = ({
	column,
	tasks,
	onOpen,
}: {
	readonly column: Place["column"];
	readonly tasks: readonly TaskCard[];
	readonly onOpen: (path: string) => void;
}) => (
	<section aria-label={columnName(column)}>
		<h3 style={TITLE}>
			{columnName(column)} <span style={MUTED}>({tasks.length})</span>
		</h3>
		<ul style={LIST}>
			{tasks.map((t) => (
				<Card key={t.id} task={t} onOpen={onOpen} />
			))}
		</ul>
	</section>
);

const COLUMN_ORDER: readonly Place["column"][] = [
	"todo",
	"in_progress",
	"done",
];

/** Which of the Team panel's views draws the run: the Board, the Flow graph or the Studio. */
export type TeamMode = "board" | "flow" | "studio" | "team";

/** How the panel switches views and draws the Flow graph and the Studio, which live outside this file. */
export type TeamControls = {
	readonly mode: TeamMode;
	readonly onMode: (mode: TeamMode) => void;
	readonly flow: (view: TeamView) => ReactNode;
	readonly studio: (
		view: TeamView,
		pulse?: { readonly event: MeteEvent; readonly before: TeamView },
	) => ReactNode;
	/** Restoring one of the run's checkpoints (ADR-079). */
	readonly restore: RestoreControls;
	/** Opens a report, by its path relative to the workspace (ADR-085). */
	readonly onOpenReport: (path: string) => void;
	/** Each member's name by role id from the run's team file, for the Team view (ADR-089). */
	readonly names: Readonly<Record<string, string>>;
	/** Each model's listed context window, for the Team view's context share (ADR-090). */
	readonly windows: Windows;
	/** The Waiting for you strip's answers for the shown run (ADR-091). */
	readonly waiting: Omit<WaitingControls, "onOpen">;
};

const modeName = (mode: TeamMode) =>
	({
		board: nls.localize("mete/board/boardMode", "Board"),
		flow: nls.localize("mete/board/flowMode", "Flow"),
		studio: nls.localize("mete/board/studioMode", "Studio"),
		team: nls.localize("mete/board/teamMode", "Team"),
	})[mode];

const MODE_ICONS: Readonly<Record<TeamMode, string>> = {
	board: "project",
	flow: "type-hierarchy",
	studio: "organization",
	team: "person",
};

const ModeSwitch = ({ controls }: { readonly controls: TeamControls }) => (
	<div style={{ display: "flex", gap: "6px" }}>
		{(["board", "flow", "studio", "team"] as const).map((mode) => (
			<button
				key={mode}
				type="button"
				className={mode === controls.mode ? "mete-button" : "mete-button quiet"}
				aria-pressed={mode === controls.mode}
				onClick={() => controls.onMode(mode)}
			>
				<span
					aria-hidden="true"
					className={`codicon codicon-${MODE_ICONS[mode]}`}
					style={{ marginRight: "6px", verticalAlign: "text-bottom" }}
				/>
				{modeName(mode)}
			</button>
		))}
	</div>
);

// The Studio's accessible list (docs/13: every visual event is also written to a list).
const Recent = ({
	view,
	recent,
}: {
	readonly view: TeamView;
	readonly recent: readonly MeteEvent[];
}) => (
	<ul
		aria-live="polite"
		aria-label={nls.localize("mete/board/recent", "Latest events")}
		style={{ ...MUTED, margin: 0, paddingLeft: "16px" }}
	>
		{recent.map((e) => (
			<li key={e.id}>{studioText(view, e)}</li>
		))}
	</ul>
);

// A single-agent run has no tasks: no board, but the Studio still seats its agent.
const NoTasks = () => (
	<p>
		{nls.localize(
			"mete/board/noTasks",
			"This run has no tasks: a single agent works without a board.",
		)}
	</p>
);

const Shown = ({
	model,
	controls,
}: {
	readonly model: Extract<BoardModel, { kind: "board" }>;
	readonly controls: TeamControls;
}) => {
	if (controls.mode === "team")
		return (
			<Roster
				members={rosterOf(model.view)}
				names={controls.names}
				windows={controls.windows}
			/>
		);
	if (controls.mode === "flow")
		return model.view.tasks.length === 0 ? (
			<NoTasks />
		) : (
			controls.flow(model.view)
		);
	if (controls.mode === "board")
		return model.view.tasks.length === 0 ? (
			<NoTasks />
		) : (
			<Columns view={model.view} onOpen={controls.onOpenReport} />
		);
	return (
		<>
			{controls.studio(model.view, model.pulse)}
			<Recent view={model.view} recent={model.recent} />
		</>
	);
};

const Columns = ({
	view,
	onOpen,
}: {
	readonly view: TeamView;
	readonly onOpen: (path: string) => void;
}) => (
	<div style={COLUMNS}>
		{COLUMN_ORDER.map((column) => (
			<Column
				key={column}
				column={column}
				tasks={view.tasks.filter((t) => placeOf(t.status).column === column)}
				onOpen={onOpen}
			/>
		))}
	</div>
);

const Board = ({
	model,
	controls,
}: {
	readonly model: Extract<BoardModel, { kind: "board" }>;
	readonly controls: TeamControls;
}) => (
	<>
		<h2 style={TITLE}>{model.goal}</h2>
		{model.unreadable > 0 ? (
			<p style={MUTED}>
				{nls.localize(
					"mete/board/unreadable",
					"{0} event(s) of this run could not be read; mete events names them.",
					model.unreadable,
				)}
			</p>
		) : null}
		{model.view.tasks.length === 0 && model.view.agents.length === 0 ? (
			<NoTasks />
		) : (
			<>
				<WaitingStrip
					view={model.view}
					names={controls.names}
					controls={{ ...controls.waiting, onOpen: controls.onOpenReport }}
				/>
				<ResultsList tasks={model.view.tasks} onOpen={controls.onOpenReport} />
				<ModeSwitch controls={controls} />
				<Shown model={model} controls={controls} />
			</>
		)}
		<CheckpointList
			checkpoints={model.view.checkpoints}
			restore={controls.restore}
		/>
	</>
);

/** What the Team panel draws for a model, in the view `controls` picks. */
export const BoardView = ({
	model,
	controls,
}: {
	readonly model: BoardModel;
	readonly controls: TeamControls;
}) => (
	<section style={BOARD} aria-live="polite">
		{model.kind === "loading" ? (
			<p>{nls.localize("mete/board/loading", "Reading the run's events…")}</p>
		) : null}
		{model.kind === "failed" ? (
			<p role="alert">{failureText(model.failure)}</p>
		) : null}
		{model.kind === "board" ? (
			<Board model={model} controls={controls} />
		) : null}
	</section>
);
