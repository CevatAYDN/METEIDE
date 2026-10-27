import { nls } from "@theia/core/lib/common/nls";
import type { HomeModel, HomeRow } from "../domain/home-model.js";
import { roleWords } from "../domain/roster.js";
import { QUOTA_LOOK, stateText } from "./quota-text.js";
import { Icon } from "./roster-look.js";
import { type Act, Button, Empty, Runs } from "./runs-list.js";
import { failureText, noFolderText } from "./status-text.js";
import { shortWhen, when } from "./time-text.js";

// The sections of the METE view (docs/13, Home; ADR-078): Waiting for you (the approvals inbox of
// ADR-048), Runs, Workspaces and Quota, each a part of Theia's view container with its own header.
// The sections hold no state of their own: the widgets pass the model and the actions.
// Text is shown as it is: React escapes it, Markdown is not involved.
// The panel root sets the METE tokens and Baloo 2 (ADR-069); the look is the side view's of the
// design set (ADR-128), in style/mete-side.css.

// A waiting run's goal opens it in the Team panel, so the human sees the task before deciding
// (ADR-091, ADR-110): the same link the Runs list uses (runs-list.tsx), reused here.
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

// A card's second line is a Runs row's without the chip, since the section says it waits
// (docs/13, ADR-109): two runs of one goal differ by their time.
const Sub = ({ row }: { readonly row: HomeRow }) => (
	<span className="mete-sub">
		{row.templateId ? `${roleWords(row.templateId)} · ` : ""}
		<span className="mete-mono" title={when(row.createdAt)}>
			{shortWhen(row.createdAt)}
		</span>
	</span>
);

// A team run waits for a decision (the check: an approval); a single-agent run waits only for a
// policy ask, which Resume repeats (docs/08), so it gets Resume and the hint — and the terminal tile.
const Waiting = ({
	row,
	act,
}: {
	readonly row: HomeRow;
	readonly act: Act;
}) => (
	<li className={`mete-item mete-side-card${row.templateId ? " warn" : ""}`}>
		<span
			className={`mete-tile${row.templateId ? " warn" : ""}`}
			aria-hidden="true"
		>
			<Icon name={row.templateId ? "check" : "terminal"} />
		</span>
		<span className="mete-side-body">
			<span className="mete-title" title={row.goal}>
				<OpenGoal row={row} act={act} />
			</span>
			<Sub row={row} />
			<div className="mete-side-actions">
				{row.templateId ? (
					<>
						<Button
							label={nls.localize("mete/home/approve", "Approve")}
							onClick={() => act("approve", row.id)}
							icon="check"
						/>
						<Button
							label={nls.localize("mete/home/revise", "Revise…")}
							onClick={() => act("revise", row.id)}
							icon="edit"
							quiet
						/>
						<Button
							label={nls.localize("mete/run/openArtifact", "Open artifact")}
							onClick={() => act("artifact", row.id)}
							icon="file"
							quiet
						/>
					</>
				) : null}
				<Button
					label={nls.localize("mete/home/resume", "Resume")}
					onClick={() => act("resume", row.id)}
					icon="play"
					quiet
				/>
			</div>
			{row.templateId ? null : (
				<span className="mete-note">
					{nls.localize("mete/home/openToAnswer", "Open the run to answer.")}
				</span>
			)}
		</span>
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
			className="mete-side-section"
			aria-label={nls.localize("mete/home/waiting", "Waiting for you")}
		>
			{waiting.length === 0 ? (
				<p className="mete-note">
					{nls.localize("mete/home/nothingWaits", "Nothing waits for you.")}
				</p>
			) : (
				<ul className="mete-side-cards">
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
			<div className="mete-side-actions">
				<Button
					label={nls.localize("mete/home/setKey", "Set provider key…")}
					onClick={onSetKey}
					icon="key"
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
	if (model.kind === "no_folder")
		return <Empty icon="folder-opened" text={noFolderText()} accent />;
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
		className="mete-side-section"
		aria-live="polite"
		aria-label={nls.localize("mete/home/runs", "Runs")}
	>
		<div className="mete-side-actions">
			{model.kind === "no_folder" ? null : (
				<Button
					label={nls.localize("mete/home/newRun", "New run")}
					onClick={onStart}
					icon="add"
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
				<Icon name="refresh" />
				{nls.localize("mete/home/refresh", "Refresh")}
			</button>
		</div>
		<Body model={model} onSetKey={onSetKey} act={onAct} shown={shown} />
	</section>
);

/**
 * The Quota section (ADR-109): the providers' chips in the side view's card, each with its state's
 * tone and glyph and the whole state in its tooltip; a click opens the dashboard.
 */
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
			className="mete-side-section"
			aria-label={nls.localize("mete/home/quota", "Quota")}
		>
			{providers.length === 0 ? (
				<p className="mete-note">
					{nls.localize(
						"mete/home/quotaUnknown",
						"The providers' states show once the daemon answers.",
					)}
				</p>
			) : (
				<div className="mete-quota-card">
					{providers.map((p) => (
						<button
							type="button"
							key={p.id}
							className={`mete-chip ${QUOTA_LOOK[p.state].tone}`}
							title={stateText(p)}
							onClick={onOpenQuota}
						>
							<Icon name={QUOTA_LOOK[p.state].icon} />
							{p.id}
						</button>
					))}
				</div>
			)}
		</section>
	);
};
