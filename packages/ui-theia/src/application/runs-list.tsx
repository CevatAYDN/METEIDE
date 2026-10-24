import type { ProviderState } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import type { HomeAction, HomeRow } from "../domain/home-model.js";
import { roleWords } from "../domain/roster.js";
import { LINK, LIST, MUTED, ROW } from "./look.js";
import { stateText } from "./quota-text.js";
import { runsText, statusTone, statusWord } from "./status-text.js";
import { shortWhen, when } from "./time-text.js";

// The run list of the METE view's Runs section (docs/13, Home; ADR-078), and the pieces the other
// sections share with it: the inbox actions and the button.

/** What a section asks the store to do with a run. */
export type Act = (action: HomeAction, runId: string) => void;

export const Button = ({
	label,
	onClick,
}: {
	readonly label: string;
	readonly onClick: () => void;
}) => (
	<button type="button" className="mete-button" onClick={onClick}>
		{label}
	</button>
);

// Under a run paused for quota: why each provider cannot carry it on now (ADR-050).
const Blocked = ({
	providers,
}: {
	readonly providers: readonly ProviderState[];
}) => (
	<ul style={{ ...MUTED, margin: "4px 0 0", paddingLeft: "16px" }}>
		{providers.map((p) => (
			<li key={p.id}>{stateText(p)}</li>
		))}
	</ul>
);

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
		style={LINK}
		title={nls.localize("mete/home/openRun", "Open in the team panel")}
		onClick={() => act("open", row.id)}
	>
		{row.goal}
	</button>
);

// A run's state as a chip: a waiting run asks for a look, the rest takes its status's tone.
const toneOf = (row: HomeRow) =>
	row.waiting ? "warn" : statusTone(row.status);

// A long goal takes two lines in the narrow side bar; the tooltip keeps it whole.
const CLAMP: CSSProperties = {
	display: "-webkit-box",
	WebkitLineClamp: 2,
	WebkitBoxOrient: "vertical",
	overflow: "hidden",
};

const ITEM: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	gap: "2px",
	padding: "4px 6px",
	margin: "0 -6px",
	borderRadius: "10px",
};

// The run the Team panel shows stands out, as a selected row does in a list.
const CURRENT: CSSProperties = {
	...ITEM,
	background: "var(--chip, var(--theia-list-activeSelectionBackground))",
	outline:
		"1.5px solid var(--line, var(--theia-contrastActiveBorder, transparent))",
};

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
	<li
		style={current ? CURRENT : ITEM}
		{...(current ? { "aria-current": "true" as const } : {})}
	>
		<span style={CLAMP} title={row.goal}>
			<OpenGoal row={row} act={act} />
		</span>
		<span style={MUTED}>
			<span className={`mete-chip ${toneOf(row)}`}>
				{statusWord(row.status)}
			</span>
			{row.templateId ? ` · ${roleWords(row.templateId)}` : ""} ·{" "}
			<span title={when(row.createdAt)}>{shortWhen(row.createdAt)}</span>
		</span>
		{row.quotaPaused && blocked.length > 0 ? (
			<Blocked providers={blocked} />
		) : null}
		{row.userPaused || row.quotaPaused ? (
			<div style={ROW}>
				<Button
					label={
						row.userPaused
							? nls.localize("mete/home/resume", "Resume")
							: nls.localize("mete/home/resumeNow", "Resume now")
					}
					onClick={() => act("resume", row.id)}
				/>
			</div>
		) : null}
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
		<p>{runsText([])}</p>
	) : (
		<ul style={LIST}>
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
