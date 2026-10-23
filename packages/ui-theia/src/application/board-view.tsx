import {
	type Place,
	placeOf,
	type TaskCard,
	type TeamView,
} from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties, ReactNode } from "react";
import type { DaemonFailure } from "../domain/status-service.js";
import { failureText } from "./status-text.js";

// The Team panel (docs/13, ADR-051): one run's tasks on the Board (To do, In progress and Done) or
// as the Flow graph, both from the view model the fold of @mete/ui-studio keeps. Text is shown as it is: React escapes it.
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
	  };

const PANEL: CSSProperties = {
	padding: "12px",
	height: "100%",
	boxSizing: "border-box",
	color: "var(--theia-foreground)",
	display: "flex",
	flexDirection: "column",
	gap: "10px",
};
const COLUMNS: CSSProperties = {
	display: "grid",
	gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
	gap: "10px",
};
const CARD: CSSProperties = {
	border: "1px solid var(--theia-panel-border)",
	borderRadius: "6px",
	padding: "6px 8px",
	display: "flex",
	flexDirection: "column",
	gap: "2px",
};
const MUTED: CSSProperties = { color: "var(--theia-descriptionForeground)" };
const TITLE: CSSProperties = { margin: 0, fontSize: "1.1em" };
const LIST: CSSProperties = {
	listStyle: "none",
	padding: 0,
	margin: "6px 0 0",
	display: "flex",
	flexDirection: "column",
	gap: "6px",
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

const Card = ({ task }: { readonly task: TaskCard }) => {
	const { marker } = placeOf(task.status);
	return (
		<li style={CARD}>
			<span>{task.title}</span>
			<span style={MUTED}>
				{task.roleId}
				{marker ? ` · ${markerText(marker)}` : ""}
			</span>
		</li>
	);
};

const Column = ({
	column,
	tasks,
}: {
	readonly column: Place["column"];
	readonly tasks: readonly TaskCard[];
}) => (
	<section aria-label={columnName(column)}>
		<h3 style={TITLE}>
			{columnName(column)} <span style={MUTED}>({tasks.length})</span>
		</h3>
		<ul style={LIST}>
			{tasks.map((t) => (
				<Card key={t.id} task={t} />
			))}
		</ul>
	</section>
);

const COLUMN_ORDER: readonly Place["column"][] = [
	"todo",
	"in_progress",
	"done",
];

/** Which of the Team panel's views draws the run: the Board or the Flow graph. */
export type TeamMode = "board" | "flow";

/** How the panel switches views and draws the Flow graph, which lives outside this file. */
export type TeamControls = {
	readonly mode: TeamMode;
	readonly onMode: (mode: TeamMode) => void;
	readonly flow: (view: TeamView) => ReactNode;
};

const ModeSwitch = ({ controls }: { readonly controls: TeamControls }) => (
	<div style={{ display: "flex", gap: "6px" }}>
		{(["board", "flow"] as const).map((mode) => (
			<button
				key={mode}
				type="button"
				className={
					mode === controls.mode ? "theia-button" : "theia-button secondary"
				}
				aria-pressed={mode === controls.mode}
				onClick={() => controls.onMode(mode)}
			>
				{mode === "board"
					? nls.localize("mete/board/boardMode", "Board")
					: nls.localize("mete/board/flowMode", "Flow")}
			</button>
		))}
	</div>
);

const Columns = ({ view }: { readonly view: TeamView }) => (
	<div style={COLUMNS}>
		{COLUMN_ORDER.map((column) => (
			<Column
				key={column}
				column={column}
				tasks={view.tasks.filter((t) => placeOf(t.status).column === column)}
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
		{model.view.tasks.length === 0 ? (
			<p>
				{nls.localize(
					"mete/board/noTasks",
					"This run has no tasks: a single agent works without a board.",
				)}
			</p>
		) : (
			<>
				<ModeSwitch controls={controls} />
				{controls.mode === "flow" ? (
					controls.flow(model.view)
				) : (
					<Columns view={model.view} />
				)}
			</>
		)}
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
	<section style={PANEL} aria-live="polite">
		{model.kind === "no_run" ? (
			<p>
				{nls.localize(
					"mete/board/noRun",
					"Choose a run with METE: Open team panel.",
				)}
			</p>
		) : null}
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
