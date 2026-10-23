import type { ProviderState } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import type { HomeModel, HomeRow } from "../domain/home-model.js";
import { stateText } from "./quota-text.js";
import { failureText, noFolderText, runsText } from "./status-text.js";

// The Home panel (docs/13, Home): the approvals inbox of ADR-048 ("Waiting for you") above the
// recent runs. The panel holds no state of its own: the widget passes the model and the actions.
// Text is shown as it is: React escapes it, Markdown is not involved.
// shortcut: inline styles on Theia's own CSS variables; the METE tokens and Baloo 2 of docs/13
// (Design system) come with packages/ui-kit, which is still empty.

/** What a button of the inbox asks for. */
export type HomeAction = "approve" | "revise" | "resume";

const PANEL: CSSProperties = {
	padding: "12px",
	color: "var(--theia-foreground)",
	display: "flex",
	flexDirection: "column",
	gap: "10px",
};
const TABLE: CSSProperties = { borderCollapse: "collapse", width: "100%" };
const CELL: CSSProperties = {
	textAlign: "left",
	padding: "4px 6px",
	borderBottom: "1px solid var(--theia-panel-border)",
	verticalAlign: "top",
};
const MUTED: CSSProperties = { color: "var(--theia-descriptionForeground)" };
const ROW: CSSProperties = { display: "flex", gap: "6px", flexWrap: "wrap" };
const TITLE: CSSProperties = { margin: 0, fontSize: "1.1em" };

const when = (iso: string) => new Date(iso).toLocaleString();

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

const Runs = ({
	rows,
	blocked,
}: {
	readonly rows: readonly HomeRow[];
	readonly blocked: readonly ProviderState[];
}) =>
	rows.length === 0 ? (
		<p>{runsText([])}</p>
	) : (
		<table style={TABLE}>
			<thead>
				<tr>
					<th scope="col" style={CELL}>
						{nls.localize("mete/home/status", "Status")}
					</th>
					<th scope="col" style={CELL}>
						{nls.localize("mete/home/goal", "Goal")}
					</th>
					<th scope="col" style={CELL}>
						{nls.localize("mete/home/created", "Created")}
					</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((r) => (
					<tr key={r.id}>
						<td style={CELL}>{r.status}</td>
						<td style={CELL}>
							<Goal row={r} />
							{r.quotaPaused && blocked.length > 0 ? (
								<Blocked providers={blocked} />
							) : null}
						</td>
						<td style={CELL}>{when(r.createdAt)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);

type Act = (action: HomeAction, runId: string) => void;

const Button = ({
	label,
	onClick,
}: {
	readonly label: string;
	readonly onClick: () => void;
}) => (
	<button type="button" className="theia-button" onClick={onClick}>
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

const Inbox = ({
	rows,
	act,
}: {
	readonly rows: readonly HomeRow[];
	readonly act: Act;
}) => {
	const waiting = rows.filter((r) => r.waiting);
	if (waiting.length === 0) return null;
	return (
		<section aria-label={nls.localize("mete/home/waiting", "Waiting for you")}>
			<h2 style={TITLE}>
				{nls.localize("mete/home/waiting", "Waiting for you")}
			</h2>
			<ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
				{waiting.map((r) => (
					<Waiting key={r.id} row={r} act={act} />
				))}
			</ul>
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
}: {
	readonly model: HomeModel;
	readonly onSetKey: () => void;
}) => {
	if (model.kind === "loading")
		return (
			<p>{nls.localize("mete/home/loading", "Asking the METE daemon…")}</p>
		);
	if (model.kind === "no_folder") return <p>{noFolderText()}</p>;
	if (model.kind === "failed")
		return <Failed model={model} onSetKey={onSetKey} />;
	return <Runs rows={model.rows} blocked={model.blocked} />;
};

/**
 * What the panel draws for a model; `onRefresh` asks the daemon again, `onAct` answers a run and
 * `onSetKey` sets a provider key.
 */
export const HomeView = ({
	model,
	onRefresh,
	onAct,
	onSetKey,
}: {
	readonly model: HomeModel;
	readonly onRefresh: () => void;
	readonly onAct: Act;
	readonly onSetKey: () => void;
}) => (
	<section style={PANEL} aria-live="polite">
		{model.kind === "runs" ? <Inbox rows={model.rows} act={onAct} /> : null}
		<h2 style={TITLE}>{nls.localize("mete/home/recentRuns", "Recent runs")}</h2>
		<Body model={model} onSetKey={onSetKey} />
		<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
			<Button
				label={nls.localize("mete/home/refresh", "Refresh")}
				onClick={onRefresh}
			/>
			{"at" in model ? (
				<span style={MUTED}>
					{nls.localize("mete/home/asOf", "As of {0}", when(model.at))}
				</span>
			) : null}
		</div>
	</section>
);
