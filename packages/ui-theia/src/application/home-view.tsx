import type { ProviderState } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import type { HomeModel, HomeRow } from "../domain/home-model.js";
import { stateText } from "./quota-text.js";
import { failureText, noFolderText, runsText } from "./status-text.js";

// The Home panel (docs/13, Home): the approvals inbox of ADR-048 ("Waiting for you") above the
// recent runs. The panel holds no state of its own: the widget passes the model and the actions.
// Text is shown as it is: React escapes it, Markdown is not involved.
// Inline styles on Theia's own CSS variables: the DOM panels keep Theia's colours, the METE tokens
// colour the Studio stage (ADR-052). shortcut: Baloo 2 waits for a decision on its font files.

/** What a button of the inbox asks for. */
export type HomeAction = "approve" | "revise" | "resume" | "open" | "artifact";

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
const LINK: CSSProperties = {
	background: "none",
	border: "none",
	padding: 0,
	color: "var(--theia-textLink-foreground)",
	cursor: "pointer",
	font: "inherit",
	textAlign: "left",
};

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
		<Goal row={row} />
	</button>
);

const Runs = ({
	rows,
	blocked,
	act,
}: {
	readonly rows: readonly HomeRow[];
	readonly blocked: readonly ProviderState[];
	readonly act: Act;
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
							<OpenGoal row={r} act={act} />
							{r.quotaPaused && blocked.length > 0 ? (
								<Blocked providers={blocked} />
							) : null}
							{r.quotaPaused ? (
								<Button
									label={nls.localize("mete/home/resumeNow", "Resume now")}
									onClick={() => act("resume", r.id)}
								/>
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
	act,
}: {
	readonly model: HomeModel;
	readonly onSetKey: () => void;
	readonly act: Act;
}) => {
	if (model.kind === "loading")
		return (
			<p>{nls.localize("mete/home/loading", "Asking the METE daemon…")}</p>
		);
	if (model.kind === "no_folder") return <p>{noFolderText()}</p>;
	if (model.kind === "failed")
		return <Failed model={model} onSetKey={onSetKey} />;
	return <Runs rows={model.rows} blocked={model.blocked} act={act} />;
};

/** A folder METE was opened on, newest first; `current` is the one open now. */
export type Workspace = {
	readonly uri: string;
	readonly name: string;
	readonly path: string;
	readonly current: boolean;
};

// The Workspaces of docs/13's Home: the folders opened before, newest first; another one opens on a
// click (Theia opens it), the current one is marked.
const Workspaces = ({
	workspaces,
	open,
}: {
	readonly workspaces: readonly Workspace[];
	readonly open: (uri: string) => void;
}) => (
	<section aria-label={nls.localize("mete/home/workspaces", "Workspaces")}>
		<h2 style={TITLE}>{nls.localize("mete/home/workspaces", "Workspaces")}</h2>
		<ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}>
			{workspaces.map((w) => (
				<li key={w.uri} title={w.path}>
					{w.current ? (
						<span>
							{w.name}{" "}
							<span style={MUTED}>
								{nls.localize("mete/home/currentWorkspace", "(open)")}
							</span>
						</span>
					) : (
						<button type="button" style={LINK} onClick={() => open(w.uri)}>
							{w.name}
						</button>
					)}{" "}
					<span style={MUTED}>{w.path}</span>
				</li>
			))}
		</ul>
	</section>
);

// The quota summary of docs/13's Home: each provider's state, in the words of METE: Quota.
const Quota = ({
	providers,
}: {
	readonly providers: readonly ProviderState[];
}) => (
	<section aria-label={nls.localize("mete/home/quota", "Quota")}>
		<h2 style={TITLE}>{nls.localize("mete/home/quota", "Quota")}</h2>
		<ul style={{ margin: "6px 0 0", paddingLeft: "16px" }}>
			{providers.map((p) => (
				<li key={p.id}>{stateText(p)}</li>
			))}
		</ul>
	</section>
);

/**
 * What the panel draws for a model; `onRefresh` asks the daemon again, `onAct` answers a run and
 * `onSetKey` sets a provider key.
 */
export const HomeView = ({
	model,
	onRefresh,
	onAct,
	onSetKey,
	workspaces = [],
	onOpenWorkspace = () => {},
}: {
	readonly model: HomeModel;
	readonly onRefresh: () => void;
	readonly onAct: Act;
	readonly onSetKey: () => void;
	readonly workspaces?: readonly Workspace[];
	readonly onOpenWorkspace?: (uri: string) => void;
}) => (
	<section style={PANEL} aria-live="polite">
		{model.kind === "runs" ? <Inbox rows={model.rows} act={onAct} /> : null}
		{workspaces.length > 0 ? (
			<Workspaces workspaces={workspaces} open={onOpenWorkspace} />
		) : null}
		<h2 style={TITLE}>{nls.localize("mete/home/recentRuns", "Recent runs")}</h2>
		<Body model={model} onSetKey={onSetKey} act={onAct} />
		{model.kind === "runs" && model.providers.length > 0 ? (
			<Quota providers={model.providers} />
		) : null}
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
