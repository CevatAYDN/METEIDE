import type { MeteEvent, ModelRef } from "@mete/contracts";
import type { TeamView } from "@mete/ui-studio";
import type { MarkdownRenderer } from "@theia/core/lib/browser/markdown-rendering/markdown-renderer";
import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties, ReactNode } from "react";
import { rosterOf } from "../domain/roster.js";
import type { DaemonFailure } from "../domain/status-service.js";
import { Columns } from "./board-columns.js";
import { CheckpointList, type RestoreControls } from "./checkpoint-list.js";
import type { Windows } from "./context-meter.js";
import { MUTED, PANEL } from "./look.js";
import { NowSlot } from "./now-slot.js";
import type { RunFacts } from "./run-hero.js";
import { RunHero } from "./run-hero-view.js";
import { RunRail } from "./run-rail.js";
import { SingleAgent } from "./single-agent.js";
import { failureText } from "./status-text.js";
import { studioText } from "./studio-text.js";
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
	/** The shown run's steps and why their latest read failed (ADR-125). */
	readonly transcript: TranscriptState;
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
}: {
	readonly model: Extract<BoardModel, { kind: "board" }>;
	readonly controls: TeamControls;
}) => {
	const steer = steerOf(controls);
	if (controls.mode === "team")
		return (
			<Roster
				members={rosterOf(model.view)}
				names={controls.names}
				windows={controls.windows}
				candidateModels={controls.candidateModels}
				preferredModels={controls.preferredModels}
				{...(steer ? { onModel: steer } : {})}
			/>
		);
	if (controls.mode === "flow")
		return model.view.tasks.length === 0 ? (
			<NoBoard model={model} controls={controls} />
		) : (
			controls.flow(model.view)
		);
	if (controls.mode === "board")
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
						<ModeSwitch controls={controls} />
						<Shown model={model} controls={controls} />
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
