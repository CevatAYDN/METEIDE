import type { ProviderState } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { HomeModel, HomeRow } from "../domain/home-model.js";
import { LIST, MUTED, ROW, SECTION } from "./look.js";
import { stateText } from "./quota-text.js";
import { type Act, Button, Runs } from "./runs-list.js";
import { failureText, noFolderText } from "./status-text.js";
import { when } from "./time-text.js";

// The sections of the METE view (docs/13, Home; ADR-078): Waiting for you (the approvals inbox of
// ADR-048), Runs, Workspaces and Quota, each a part of Theia's view container with its own header.
// The sections hold no state of their own: the widgets pass the model and the actions.
// Text is shown as it is: React escapes it, Markdown is not involved.
// The panel root sets the METE tokens and Baloo 2 (ADR-069); the styles come from look.ts.

const Goal = ({ row }: { readonly row: HomeRow }) => (
	<>
		{row.goal}
		{row.templateId ? <span style={MUTED}> · {row.templateId}</span> : null}
	</>
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
