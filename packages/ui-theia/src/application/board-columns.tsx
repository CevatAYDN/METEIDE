import {
	type Place,
	placeOfTask,
	type TaskCard,
	type TeamView,
} from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import { LINK, LIST, MUTED, TITLE } from "./look.js";
import { openReportLabel, reportPath } from "./results-list.js";
import { columnName, markerText } from "./task-words.js";

// The Board's columns (docs/13, ADR-051): To do, In progress and Done, each task a card with its member
// and the marker of its status.

// The columns share the width.
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

// A Done card opens its report; another column's report may still change (ADR-085).
const Card = ({
	task,
	onOpen,
}: {
	readonly task: TaskCard;
	readonly onOpen: (path: string) => void;
}) => {
	const { column, marker } = placeOfTask(task);
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

/** The run's tasks in their columns; a Done card opens its report. */
export const Columns = ({
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
				tasks={view.tasks.filter((t) => placeOfTask(t).column === column)}
				onOpen={onOpen}
			/>
		))}
	</div>
);
