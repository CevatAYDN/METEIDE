import type { ProviderState } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import {
	type HomeAction,
	type HomeRow,
	hasEnded,
} from "../domain/home-model.js";
import { roleWords } from "../domain/roster.js";
import { QUOTA_LOOK, stateText } from "./quota-text.js";
import { Icon } from "./roster-look.js";
import { runsText, statusTone, statusWord } from "./status-text.js";
import { shortWhen, when } from "./time-text.js";
import { toneStyle } from "./tone.js";

// The run list of the METE view's Runs section (docs/13, Home; ADR-078), and the pieces the other
// sections share with it: the inbox actions, the button and the empty card. The look is the side
// view's of the design set (ADR-128), in style/mete-side.css.

/** What a section asks the store to do with a run. */
export type Act = (action: HomeAction, runId: string) => void;

/** The main action of a row is the accent button; the others are quiet (ADR-128). */
export const Button = ({
	label,
	onClick,
	icon,
	quiet,
}: {
	readonly label: string;
	readonly onClick: () => void;
	readonly icon?: string;
	readonly quiet?: boolean;
}) => (
	<button
		type="button"
		className={quiet ? "mete-button quiet" : "mete-button"}
		onClick={onClick}
	>
		{icon ? <Icon name={icon} /> : null}
		{label}
	</button>
);

/** An empty section's dashed card (ADR-128): a tile with the section's glyph, then the sentence. */
export const Empty = ({
	icon,
	text,
	accent,
}: {
	readonly icon: string;
	readonly text: string;
	readonly accent?: boolean;
}) => (
	<div className="mete-side-empty">
		<span className={accent ? "mete-tile accent" : "mete-tile"}>
			<Icon name={icon} />
		</span>
		<p>{text}</p>
	</div>
);

// Under a run paused for quota: why each provider cannot carry it on now (ADR-050), each after a
// dot in its state's tone.
const Blocked = ({
	providers,
}: {
	readonly providers: readonly ProviderState[];
}) => (
	<ul className="mete-side-box">
		{providers.map((p) => (
			<li key={p.id} style={toneStyle(QUOTA_LOOK[p.state].tone)}>
				{stateText(p)}
			</li>
		))}
	</ul>
);

/** Why a paused run waits for someone to go on with it. */
export type PausedFor = "quota" | "user" | "budget";

/**
 * Under a run someone must go on with: a quota pause before its reset with why each provider cannot
 * carry it on (ADR-059, ADR-050), a user's pause (ADR-061), or a budget pause, which names its budget
 * first (ADR-126). The side-bar row and the Team panel's hero band show the same (docs/13).
 */
export const PausedRun = ({
	reason,
	blocked,
	onResume,
}: {
	readonly reason: PausedFor | undefined;
	readonly blocked: readonly ProviderState[];
	readonly onResume: () => void;
}) =>
	reason ? (
		<>
			{reason === "quota" && blocked.length > 0 ? (
				<Blocked providers={blocked} />
			) : null}
			{reason === "budget" ? (
				<p className="mete-side-box">
					{nls.localize(
						"mete/home/budgetPaused",
						"It used its budget: 25 model turns at a time, or the requests or hours of .mete/policy.yaml. Resume gives it 25 more turns; raise the requests or hours there first if they ran out.",
					)}
				</p>
			) : null}
			<div className="mete-side-actions">
				<Button
					label={
						reason === "quota"
							? nls.localize("mete/home/resumeNow", "Resume now")
							: nls.localize("mete/home/resume", "Resume")
					}
					onClick={onResume}
					icon="play"
					quiet
				/>
			</div>
		</>
	) : null;

const pausedFor = (row: HomeRow): PausedFor | undefined => {
	if (row.quotaPaused) return "quota";
	if (row.userPaused) return "user";
	return row.budgetPaused ? "budget" : undefined;
};

// A run's goal opens it in the Team panel (ADR-051); a button styled as a link keeps the keyboard.
const OpenGoal = ({
	row,
	act,
}: {
	readonly row: HomeRow;
	readonly act: Act;
}) => (
	<button
		type="button"
		className="mete-link"
		title={nls.localize("mete/home/openRun", "Open in the team panel")}
		onClick={() => act("open", row.id)}
	>
		{row.goal}
	</button>
);

// An ended run's Remove, the small pill a workspace's Forget is (ADR-084, ADR-143); the command asks
// before anything goes.
const Remove = ({ row, act }: { readonly row: HomeRow; readonly act: Act }) => (
	<button
		type="button"
		className="mete-forget"
		aria-label={nls.localize("mete/home/removeRun", "Remove {0}", row.goal)}
		onClick={() => act("remove", row.id)}
	>
		{nls.localize("mete/home/remove", "Remove")}
	</button>
);

// A run's state as a chip: a waiting run asks for a look, the rest takes its status's tone.
const toneOf = (row: HomeRow) =>
	row.waiting ? "warn" : statusTone(row.status);

// The side view's row icon (ADR-109): the state as a glyph, a waiting run as the bell that asks.
const ICON: Record<string, string> = {
	queued: "clock",
	running: "loading",
	paused: "pulse",
	completed: "check",
	failed: "error",
	cancelled: "circle-slash",
};
const iconOf = (row: HomeRow) =>
	row.waiting ? "bell" : (ICON[row.status] ?? "circle-outline");

const RunItem = ({
	row,
	blocked,
	act,
	current,
}: {
	readonly row: HomeRow;
	readonly blocked: readonly ProviderState[];
	readonly act: Act;
	readonly current: boolean;
}) => (
	// The side view's row (ADR-109): the state's tile, the goal as the title, the chip and the when
	// as the subtitle; the run the Team panel shows stands out as a selected row does.
	<li
		className="mete-item"
		{...(current ? { "aria-current": "true" as const } : {})}
	>
		<span className={`mete-tile ${toneOf(row)}`} aria-hidden="true">
			{/* A running row's glyph turns, so the list shows which runs are at work (ADR-128). */}
			<Icon
				name={iconOf(row)}
				spin={row.status === "running" && !row.waiting}
			/>
		</span>
		<span className="mete-side-body">
			{/* A long goal takes two lines in the narrow side bar; the tooltip keeps it whole. */}
			<span className="mete-clamp" title={row.goal}>
				<OpenGoal row={row} act={act} />
			</span>
			<span className="mete-sub mete-run-sub">
				<span>
					<span className={`mete-chip ${toneOf(row)}`}>
						{statusWord(row.status)}
					</span>
					{row.templateId ? ` · ${roleWords(row.templateId)}` : ""} ·{" "}
					<span className="mete-mono" title={when(row.createdAt)}>
						{shortWhen(row.createdAt)}
					</span>
				</span>
				{hasEnded(row) ? <Remove row={row} act={act} /> : null}
			</span>
			<PausedRun
				reason={pausedFor(row)}
				blocked={blocked}
				onResume={() => act("resume", row.id)}
			/>
		</span>
	</li>
);

/** The open folder's runs as the daemon lists them; a goal opens its run in the Team panel. */
export const Runs = ({
	rows,
	blocked,
	act,
	shown,
}: {
	readonly rows: readonly HomeRow[];
	readonly blocked: readonly ProviderState[];
	readonly act: Act;
	readonly shown: string | undefined;
}) =>
	rows.length === 0 ? (
		<Empty icon="list-unordered" text={runsText([])} />
	) : (
		<ul className="mete-side-list">
			{rows.map((r) => (
				<RunItem
					key={r.id}
					row={r}
					blocked={blocked}
					act={act}
					current={r.id === shown}
				/>
			))}
		</ul>
	);
