import type { MeteEvent, ModelRef } from "@mete/contracts";
import type { TeamView } from "@mete/ui-studio";
import type { MarkdownRenderer } from "@theia/core/lib/browser/markdown-rendering/markdown-renderer";
import { nls } from "@theia/core/lib/common/nls";
import { type CSSProperties, type ReactNode, useId } from "react";
import { rosterOf } from "../domain/roster.js";
import type { DaemonFailure } from "../domain/status-service.js";
import { Columns } from "./board-columns.js";
import { CheckpointList, type RestoreControls } from "./checkpoint-list.js";
import type { PickerFacts } from "./composer.js";
import type { Windows } from "./context-meter.js";
import { MUTED, PANEL } from "./look.js";
import { NowSlot } from "./now-slot.js";
import type { RunFacts } from "./run-hero.js";
import { RunHero } from "./run-hero-view.js";
import { RunRail } from "./run-rail.js";
import { Answer, Failure, SingleAgent } from "./single-agent.js";
import { failureText } from "./status-text.js";
import { studioText } from "./studio-text.js";
import { TabList } from "./tab-list.js";
import { TeamView as Roster } from "./team-view.js";
import type { TranscriptState } from "./transcript-session.js";
import type { WaitingControls } from "./waiting-strip.js";

// The Team panel (docs/13, ADR-051): one run's tasks on the Board (To do, In progress and Done),
// its members in the Team view (ADR-089) or as the Flow graph, both from the view model the fold of @mete/ui-studio keeps. Text is shown as it is: React escapes it.
// Inline styles on Theia's CSS variables, as the Home view: the DOM panels keep Theia's colours (ADR-052).
// Under the hero band (ADR-127), a center column and the right rail (ADR-119), laid out by style/mete-run.css.

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
			/** The run's latest events of the Team view's Activity feed (ADR-092). */
			readonly feed: readonly MeteEvent[];
			/** A finished run's summary: the single agent's answer or the team's last report. */
			readonly answer?: string;
			/** A failed run's code and message (ADR-128). */
			readonly runFailed?: { readonly code: string; readonly message: string };
			/** The last live event and the view before it, for the Studio's effects. */
			readonly pulse?: { readonly event: MeteEvent; readonly before: TeamView };
	  };

// The Board fills the panel.
const BOARD: CSSProperties = {
	...PANEL,
	height: "100%",
	boxSizing: "border-box",
};

// The statuses in which a run's model can still be changed (ADR-122).
const STEERABLE: ReadonlySet<string> = new Set(["queued", "running", "paused"]);

/** The panel's model setter while the run has not ended, and nothing once it has (ADR-122). */
const steerOf = (controls: TeamControls) =>
	STEERABLE.has(controls.run.run?.status ?? "") ? controls.onModel : undefined;

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
	/** Draws model text as sanitized Markdown, through Theia's renderer. */
	readonly markdown: MarkdownRenderer;
	/** Restoring one of the run's checkpoints (ADR-079). */
	readonly restore: RestoreControls;
	/** Opens a report, by its path relative to the workspace (ADR-085). */
	readonly onOpenReport: (path: string) => void;
	/** Each member's name by role id from the run's team file, for the Team view (ADR-089). */
	readonly names: Readonly<Record<string, string>>;
	/** Each model's listed context window, for the Team view's context share (ADR-090). */
	readonly windows: Windows;
	/** The Now slot's Waiting for you answers for the shown run (ADR-091, ADR-127). */
	readonly waiting: Omit<WaitingControls, "onOpen">;
	/** What the daemon says of the shown run, for the hero band (ADR-094, ADR-127). */
	readonly run: RunFacts;
	/** Sets or clears role preferred model mid-run (ADR-122). */
	readonly onModel?: (roleId: string, model: ModelRef | null) => void;
	/** Candidate models for selection per role or tier (ADR-122). */
	readonly candidateModels?:
		| Readonly<Record<string, readonly string[]>>
		| undefined;
	/** Preferred models per role (ADR-122). */
	readonly preferredModels?: Readonly<Record<string, string>> | undefined;
	/** The candidates' facts and the providers' states, for the model picker (ADR-161). */
	readonly modelFacts?: PickerFacts | undefined;
	/** The shown run's steps and why their latest read failed (ADR-125). */
	readonly transcript: TranscriptState;
};

const MODE_ICONS: Readonly<Record<TeamMode, string>> = {
	board: "project",
	flow: "type-hierarchy",
	studio: "organization",
	team: "person",
};

// A run without tasks draws its steps where the Board would be, and has no graph to draw (ADR-127).
const modesOf = (view: TeamView): readonly TeamMode[] =>
	view.tasks.length === 0
		? ["board", "studio", "team"]
		: ["board", "flow", "studio", "team"];

/** The view drawn: the one picked, or the steps for a Flow picked on a run that has no tasks. */
const shownMode = (mode: TeamMode, view: TeamView): TeamMode =>
	modesOf(view).includes(mode) ? mode : "board";

const modeName = (mode: TeamMode, steps: boolean) =>
	steps && mode === "board"
		? nls.localize("mete/board/stepsMode", "Steps")
		: {
				board: nls.localize("mete/board/boardMode", "Board"),
				flow: nls.localize("mete/board/flowMode", "Flow"),
				studio: nls.localize("mete/board/studioMode", "Studio"),
				team: nls.localize("mete/board/teamMode", "Team"),
			}[mode];

// The segmented control (ADR-127): Board · Flow · Studio · Team, or Steps · Studio · Team.
const ViewSwitch = ({
	id,
	mode,
	view,
	onMode,
}: {
	readonly id: string;
	readonly mode: TeamMode;
	readonly view: TeamView;
	readonly onMode: (mode: TeamMode) => void;
}) => {
	const steps = view.tasks.length === 0;
	return (
		<TabList
			id={id}
			className="mete-segmented"
			tabs={modesOf(view).map((m) => ({
				key: m,
				icon: steps && m === "board" ? "list-ordered" : MODE_ICONS[m],
				label: modeName(m, steps),
			}))}
			shown={mode}
			onPick={onMode}
		/>
	);
};

// The Studio's accessible list (docs/13: every visual event is also written to a list), under its
// visible caption (ADR-128).
const Recent = ({
	view,
	recent,
}: {
	readonly view: TeamView;
	readonly recent: readonly MeteEvent[];
}) => {
	const caption = nls.localize("mete/board/recent", "Latest events");
	return (
		<section className="mete-recent">
			<h3>{caption}</h3>
			<ul aria-live="polite" aria-label={caption}>
				{recent.map((e) => (
					<li key={e.id}>{studioText(view, e)}</li>
				))}
			</ul>
		</section>
	);
};

// An ended single agent leads its center with its answer (ADR-127), or with its failure (ADR-128).
const Ended = ({
	model,
	controls,
}: {
	readonly model: Extract<BoardModel, { kind: "board" }>;
	readonly controls: TeamControls;
}) =>
	model.answer ? (
		<Answer text={model.answer} markdown={controls.markdown} />
	) : model.runFailed ? (
		<Failure {...model.runFailed} />
	) : null;

// A run without tasks is a single agent: its steps and answer, not an empty board (ADR-125).
const NoBoard = ({
	model,
	controls,
}: {
	readonly model: Extract<BoardModel, { kind: "board" }>;
	readonly controls: TeamControls;
}) => (
	<SingleAgent
		view={model.view}
		answer={model.answer}
		transcript={controls.transcript}
		markdown={controls.markdown}
		live={controls.run.run?.status === "running"}
	/>
);

const Shown = ({
	model,
	controls,
	mode,
}: {
	readonly model: Extract<BoardModel, { kind: "board" }>;
	readonly controls: TeamControls;
	readonly mode: TeamMode;
}) => {
	const steer = steerOf(controls);
	if (mode === "team")
		return (
			<Roster
				members={rosterOf(model.view)}
				names={controls.names}
				windows={controls.windows}
				candidateModels={controls.candidateModels}
				preferredModels={controls.preferredModels}
				modelFacts={controls.modelFacts}
				{...(steer ? { onModel: steer } : {})}
			/>
		);
	if (mode === "flow") return controls.flow(model.view);
	if (mode === "board")
		return model.view.tasks.length === 0 ? (
			<NoBoard model={model} controls={controls} />
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

// The view switch over the chosen view, as tabs and their panel.
const Views = ({
	model,
	controls,
}: {
	readonly model: Extract<BoardModel, { kind: "board" }>;
	readonly controls: TeamControls;
}) => {
	const id = useId();
	const mode = shownMode(controls.mode, model.view);
	return (
		<>
			<ViewSwitch
				id={id}
				mode={mode}
				view={model.view}
				onMode={controls.onMode}
			/>
			<div
				role="tabpanel"
				id={`${id}-${mode}-panel`}
				aria-labelledby={`${id}-${mode}`}
				className="mete-view"
			>
				<Shown model={model} controls={controls} mode={mode} />
			</div>
		</>
	);
};

const Board = ({
	model,
	controls,
}: {
	readonly model: Extract<BoardModel, { kind: "board" }>;
	readonly controls: TeamControls;
}) => (
	<>
		<RunHero
			goal={model.goal}
			facts={controls.run}
			view={model.view}
			names={controls.names}
			onResume={controls.waiting.onResume}
		/>
		{model.unreadable > 0 ? (
			<p style={MUTED}>
				{nls.localize(
					"mete/board/unreadable",
					"{0} event(s) of this run could not be read; mete events names them.",
					model.unreadable,
				)}
			</p>
		) : null}
		<div className="mete-run-body">
			<div className="mete-run-center">
				{model.view.tasks.length === 0 ? (
					<Ended model={model} controls={controls} />
				) : null}
				{model.view.tasks.length === 0 && model.view.agents.length === 0 ? (
					<NoBoard model={model} controls={controls} />
				) : (
					<>
						<NowSlot
							view={model.view}
							names={controls.names}
							windows={controls.windows}
							waiting={{ ...controls.waiting, onOpen: controls.onOpenReport }}
						/>
						<Views model={model} controls={controls} />
					</>
				)}
				<CheckpointList
					checkpoints={model.view.checkpoints}
					restore={controls.restore}
				/>
			</div>
			<RunRail
				view={model.view}
				feed={model.feed}
				names={controls.names}
				markdown={controls.markdown}
				transcript={controls.transcript.transcript}
				status={controls.run.run?.status}
				onOpenReport={controls.onOpenReport}
			/>
		</div>
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
	// Not a live region as a whole: the rail's feed changes with every event (ADR-119), and the
	// Studio's list, the one event-by-event announcement, has its own.
	<section className="mete-run" style={BOARD}>
		{model.kind === "loading" ? (
			<p aria-live="polite">
				{nls.localize("mete/board/loading", "Reading the run's events…")}
			</p>
		) : null}
		{model.kind === "failed" ? (
			<p role="alert">{failureText(model.failure)}</p>
		) : null}
		{model.kind === "board" ? (
			<Board model={model} controls={controls} />
		) : null}
	</section>
);
