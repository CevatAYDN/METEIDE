import type { MeteEvent, Transcript } from "@mete/contracts";
import type { TeamView } from "@mete/ui-studio";
import type { MarkdownRenderer } from "@theia/core/lib/browser/markdown-rendering/markdown-renderer";
import { nls } from "@theia/core/lib/common/nls";
import { type KeyboardEvent, type ReactNode, useId, useState } from "react";
import { FeedView } from "./feed-view.js";
import { MUTED } from "./look.js";
import { RailTasks } from "./rail-tasks.js";
import { ResultsList, reportPath } from "./results-list.js";
import { Icon } from "./roster-look.js";
import type { RunEntry } from "./run-hero.js";

// The Team panel's right rail (ADR-119): Activity, the run's feed (ADR-092); Artifacts, its reports
// (ADR-085); and Tasks, as WAI-ARIA tabs. Every panel stays mounted and only the shown one is
// visible, so the feed keeps its segment and Follow across a switch.

/** A tab of the rail. */
export type RailTab = "activity" | "artifacts" | "tasks";

const TABS: readonly RailTab[] = ["activity", "artifacts", "tasks"];

const ICONS: Readonly<Record<RailTab, string>> = {
	activity: "pulse",
	artifacts: "package",
	tasks: "checklist",
};

const tabName = (tab: RailTab) =>
	({
		activity: nls.localize("mete/rail/activity", "Activity"),
		artifacts: nls.localize("mete/rail/artifacts", "Artifacts"),
		tasks: nls.localize("mete/rail/tasks", "Tasks"),
	})[tab];

const FINISHED: ReadonlySet<RunEntry["status"]> = new Set([
	"completed",
	"failed",
	"cancelled",
]);

/** The tab the rail opens on until the user picks one: a finished run's reports, else the activity. */
export const openingTab = (
	status: RunEntry["status"] | undefined,
	reports: number,
): RailTab =>
	status && FINISHED.has(status) && reports > 0 ? "artifacts" : "activity";

/** The tab an arrow, Home or End key moves to, wrapping at the ends; none for another key. */
export const stepTab = (tab: RailTab, key: string): RailTab | undefined => {
	const at = TABS.indexOf(tab);
	if (key === "ArrowRight") return TABS[(at + 1) % TABS.length];
	if (key === "ArrowLeft") return TABS[(at + TABS.length - 1) % TABS.length];
	if (key === "Home") return TABS[0];
	if (key === "End") return TABS[TABS.length - 1];
	return undefined;
};

const Reports = ({
	view,
	count,
	onOpen,
}: {
	readonly view: TeamView;
	readonly count: number;
	readonly onOpen: (path: string) => void;
}) =>
	count > 0 ? (
		<ResultsList tasks={view.tasks} onOpen={onOpen} />
	) : (
		<p style={{ ...MUTED, margin: 0 }}>
			{nls.localize(
				"mete/rail/noReports",
				"No reports yet: a task's report shows here once it is written.",
			)}
		</p>
	);

// One tab in the tab order, the shown one; the keys move the choice and the focus together.
const Tabs = ({
	id,
	shown,
	reports,
	onPick,
}: {
	readonly id: string;
	readonly shown: RailTab;
	readonly reports: number;
	readonly onPick: (tab: RailTab) => void;
}) => {
	const onKey = (e: KeyboardEvent<HTMLElement>) => {
		const next = stepTab(shown, e.key);
		if (!next) return;
		e.preventDefault();
		onPick(next);
		e.currentTarget.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
	};
	return (
		<div role="tablist" className="mete-rail-tabs" onKeyDown={onKey}>
			{TABS.map((tab) => (
				<button
					key={tab}
					type="button"
					role="tab"
					id={`${id}-${tab}`}
					data-tab={tab}
					aria-selected={tab === shown}
					aria-controls={`${id}-${tab}-panel`}
					tabIndex={tab === shown ? 0 : -1}
					onClick={() => onPick(tab)}
				>
					<Icon name={ICONS[tab]} />
					{tabName(tab)}
					{tab === "artifacts" ? (
						<span className="mete-count">{reports}</span>
					) : null}
				</button>
			))}
		</div>
	);
};

/** The rail beside the chosen view. */
export const RunRail = ({
	view,
	feed,
	names,
	status,
	onOpenReport,
	markdown,
	transcript,
}: {
	readonly view: TeamView;
	readonly feed: readonly MeteEvent[];
	readonly names: Readonly<Record<string, string>>;
	readonly status: RunEntry["status"] | undefined;
	readonly onOpenReport: (path: string) => void;
	readonly markdown: MarkdownRenderer;
	readonly transcript?: Transcript | undefined;
}) => {
	const id = useId();
	const [picked, setPicked] = useState<RailTab>();
	const reports = view.tasks.filter((t) => reportPath(t)).length;
	const shown = picked ?? openingTab(status, reports);
	const panels: Readonly<Record<RailTab, ReactNode>> = {
		activity: (
			<FeedView view={view} feed={feed} names={names} markdown={markdown} />
		),
		artifacts: <Reports view={view} count={reports} onOpen={onOpenReport} />,
		tasks: (
			<RailTasks
				view={view}
				names={names}
				steps={{ transcript, markdown, live: status === "running" }}
			/>
		),
	};
	return (
		<section
			className="mete-run-rail"
			aria-label={nls.localize("mete/rail/label", "Run details")}
		>
			<Tabs id={id} shown={shown} reports={reports} onPick={setPicked} />
			{TABS.map((tab) => (
				<div
					key={tab}
					role="tabpanel"
					id={`${id}-${tab}-panel`}
					aria-labelledby={`${id}-${tab}`}
					hidden={shown !== tab}
				>
					{panels[tab]}
				</div>
			))}
		</section>
	);
};
