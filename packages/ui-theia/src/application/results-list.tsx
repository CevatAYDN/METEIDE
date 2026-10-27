import type { TaskCard } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import { LIST, MUTED, ROW } from "./look.js";

// The Team panel's Results (ADR-085), the rail's Artifacts tab that names them (ADR-119): each
// task's latest report, as the fold keeps it from artifact.created and artifact.updated, with Open.
// Nothing shows while no task has a report.

/** A report's path relative to the workspace, with forward slashes. */
export const reportPath = (task: TaskCard) =>
	task.artifactPath?.replaceAll("\\", "/");

const fileOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** The label of a report's Open button, which names its task for a screen reader. */
export const openReportLabel = (task: TaskCard) =>
	nls.localize("mete/board/openReportOf", "Open the report of {0}", task.title);

/** The files a completed run changed (ADR-133), each with Open, as paths relative to the run's folder. */
export const FilesList = ({
	files,
	onOpen,
}: {
	readonly files: readonly string[];
	readonly onOpen: (path: string) => void;
}) => (
	<section aria-label={nls.localize("mete/board/files", "Files")}>
		<ul style={{ ...LIST, margin: 0 }}>
			{files.map((path) => (
				<li key={path} style={ROW}>
					<span>{path}</span>
					<button
						type="button"
						className="mete-button quiet"
						aria-label={nls.localize("mete/board/openFile", "Open {0}", path)}
						onClick={() => onOpen(path)}
					>
						{nls.localize("mete/board/openResult", "Open")}
					</button>
				</li>
			))}
		</ul>
	</section>
);

export const ResultsList = ({
	tasks,
	onOpen,
}: {
	readonly tasks: readonly TaskCard[];
	readonly onOpen: (path: string) => void;
}) => {
	const reports = tasks.flatMap((t) => {
		const path = reportPath(t);
		return path ? [{ task: t, path }] : [];
	});
	if (reports.length === 0) return null;
	return (
		<section aria-label={nls.localize("mete/board/results", "Results")}>
			<ul style={{ ...LIST, margin: 0 }}>
				{reports.map(({ task, path }) => (
					<li key={task.id} style={ROW} title={path}>
						<span>{task.title}</span>
						<span style={MUTED}>{fileOf(path)}</span>
						<button
							type="button"
							className="mete-button quiet"
							aria-label={openReportLabel(task)}
							onClick={() => onOpen(path)}
						>
							{nls.localize("mete/board/openResult", "Open")}
						</button>
					</li>
				))}
			</ul>
		</section>
	);
};
