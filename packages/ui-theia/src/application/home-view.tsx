import type { ProviderState } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import type { HomeModel, HomeRow } from "../domain/home-model.js";
import { LINK, LIST, MUTED, ROW, SECTION } from "./look.js";
import { stateText } from "./quota-text.js";
import { failureText, noFolderText, runsText } from "./status-text.js";

// The sections of the METE view (docs/13, Home; ADR-078): Waiting for you (the approvals inbox of
// ADR-048), Runs, Workspaces and Quota, each a part of Theia's view container with its own header.
// The sections hold no state of their own: the widgets pass the model and the actions.
// Text is shown as it is: React escapes it, Markdown is not involved.
// The panel root sets the METE tokens and Baloo 2 (ADR-069); the styles come from look.ts.

/** What a button of the inbox asks for. */
export type HomeAction = "approve" | "revise" | "resume" | "open" | "artifact";

const when = (iso: string) => new Date(iso).toLocaleString();

const HOUR = { hour: "2-digit", minute: "2-digit" } as const;

/**
 * A run's time as the narrow list shows it: the hour and minute for a run of today, with the day and
 * month for an older one; the tooltip keeps the whole time. Absolute, so it never goes stale.
 */
export const shortWhen = (iso: string, now = new Date()) => {
	const at = new Date(iso);
	return at.toDateString() === now.toDateString()
		? at.toLocaleTimeString(undefined, HOUR)
		: at.toLocaleString(undefined, { day: "numeric", month: "short", ...HOUR });
};

const Goal = ({ row }: { readonly row: HomeRow }) => (
	<>
		{row.goal}
		{row.templateId ? <span style={MUTED}> · {row.templateId}</span> : null}
	</>
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

// A run's state as a chip: waiting and paused ask for a look, a failure stands out.
const toneOf = (row: HomeRow) => {
	if (row.waiting || row.status === "paused") return "warn";
	if (row.status === "failed") return "bad";
	return row.status === "running" ? "good" : "";
};

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
			<span className={`mete-chip ${toneOf(row)}`}>{row.status}</span>
			{row.templateId ? ` · ${row.templateId}` : ""} ·{" "}
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

// The open folder's runs as the daemon lists them; a goal opens its run in the Team panel.
const Runs = ({
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

type Act = (action: HomeAction, runId: string) => void;

const Button = ({
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

// A team run waits for a decision; a single-agent run waits only for a policy ask, which Resume
// repeats (docs/08), so it gets Resume and the hint.
const Waiting = ({
	row,
	act,
}: {
	readonly row: HomeRow;
	readonly act: Act;
}) => (
	<li style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
		<span>
			<Goal row={row} />
		</span>
		<div style={ROW}>
			{row.templateId ? (
				<>
					<Button
						label={nls.localize("mete/home/approve", "Approve")}
						onClick={() => act("approve", row.id)}
					/>
					<Button
						label={nls.localize("mete/home/revise", "Revise…")}
						onClick={() => act("revise", row.id)}
					/>
					<Button
						label={nls.localize("mete/run/openArtifact", "Open artifact")}
						onClick={() => act("artifact", row.id)}
					/>
				</>
			) : null}
			<Button
				label={nls.localize("mete/home/resume", "Resume")}
				onClick={() => act("resume", row.id)}
			/>
		</div>
		{row.templateId ? null : (
			<span style={MUTED}>
				{nls.localize(
					"mete/home/resumeHint",
					"Resume repeats the tool call the policy asked about, so the run stops again unless .mete/policy.yaml allows it.",
				)}
			</span>
		)}
	</li>
);

/** The Waiting for you section (ADR-048, ADR-078): the runs that wait for an answer, with the answers. */
export const WaitingSection = ({
	model,
	onAct,
}: {
	readonly model: HomeModel;
	readonly onAct: Act;
}) => {
	const waiting =
		model.kind === "runs" ? model.rows.filter((r) => r.waiting) : [];
	return (
		<section
			style={SECTION}
			aria-label={nls.localize("mete/home/waiting", "Waiting for you")}
		>
			{waiting.length === 0 ? (
				<p style={MUTED}>
					{nls.localize("mete/home/nothingWaits", "Nothing waits for you.")}
				</p>
			) : (
				<ul style={LIST}>
					{waiting.map((r) => (
						<Waiting key={r.id} row={r} act={onAct} />
					))}
				</ul>
			)}
		</section>
	);
};

// Not ready is mostly a missing provider key, so the panel offers the way to add one (ADR-049).
const Failed = ({
	model,
	onSetKey,
}: {
	readonly model: Extract<HomeModel, { kind: "failed" }>;
	readonly onSetKey: () => void;
}) => (
	<>
		<p role="alert">{failureText(model.failure)}</p>
		{model.failure.code === "not_ready" ? (
			<div style={ROW}>
				<Button
					label={nls.localize("mete/home/setKey", "Set provider key…")}
					onClick={onSetKey}
				/>
			</div>
		) : null}
	</>
);

const Body = ({
	model,
	onSetKey,
	act,
	shown,
}: {
	readonly model: HomeModel;
	readonly onSetKey: () => void;
	readonly act: Act;
	readonly shown: string | undefined;
}) => {
	if (model.kind === "loading")
		return (
			<p>{nls.localize("mete/home/loading", "Asking the METE daemon…")}</p>
		);
	if (model.kind === "no_folder") return <p>{noFolderText()}</p>;
	if (model.kind === "failed")
		return <Failed model={model} onSetKey={onSetKey} />;
	return (
		<Runs rows={model.rows} blocked={model.blocked} act={act} shown={shown} />
	);
};

/**
 * The Runs section (ADR-078): New run opens the composer, `onRefresh` asks the daemon again,
 * `onAct` answers a run and `onSetKey` sets a provider key.
 */
export const RunsSection = ({
	model,
	onRefresh,
	onAct,
	onSetKey,
	onStart,
	shown,
}: {
	readonly model: HomeModel;
	readonly onRefresh: () => void;
	readonly onAct: Act;
	readonly onSetKey: () => void;
	readonly onStart: () => void;
	/** The run the Team panel shows, which the list marks. */
	readonly shown?: string | undefined;
}) => (
	<section
		style={SECTION}
		aria-live="polite"
		aria-label={nls.localize("mete/home/runs", "Runs")}
	>
		<div style={ROW}>
			{model.kind === "no_folder" ? null : (
				<Button
					label={nls.localize("mete/home/newRun", "New run")}
					onClick={onStart}
				/>
			)}
			{/* The list follows the run events by itself; Refresh is for a daemon that came back. */}
			<button
				type="button"
				className="mete-button quiet"
				onClick={onRefresh}
				{...("at" in model
					? {
							title: nls.localize(
								"mete/home/asOf",
								"As of {0}",
								when(model.at),
							),
						}
					: {})}
			>
				{nls.localize("mete/home/refresh", "Refresh")}
			</button>
		</div>
		<Body model={model} onSetKey={onSetKey} act={onAct} shown={shown} />
	</section>
);

// A chip's colour by state; the chip's tooltip says the whole state in the words of METE: Quota.
const QUOTA_TONE: { readonly [S in ProviderState["state"]]: string } = {
	ready: "good",
	no_key: "warn",
	exhausted: "warn",
	inactive: "bad",
	unusable: "bad",
};

/** The Quota section: a chip per provider; a click opens the Quota dashboard. */
export const QuotaSection = ({
	model,
	onOpenQuota,
}: {
	readonly model: HomeModel;
	readonly onOpenQuota: () => void;
}) => {
	const providers = model.kind === "runs" ? model.providers : [];
	return (
		<section
			style={SECTION}
			aria-label={nls.localize("mete/home/quota", "Quota")}
		>
			{providers.length === 0 ? (
				<p style={MUTED}>
					{nls.localize(
						"mete/home/quotaUnknown",
						"The providers' states show once the daemon answers.",
					)}
				</p>
			) : (
				<div style={ROW}>
					{providers.map((p) => (
						<button
							type="button"
							key={p.id}
							className={`mete-chip ${QUOTA_TONE[p.state]}`}
							title={stateText(p)}
							onClick={onOpenQuota}
						>
							{p.id}
						</button>
					))}
				</div>
			)}
		</section>
	);
};
