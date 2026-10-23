import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import type { HomeModel, HomeRow } from "../domain/home-model.js";
import { failureText, noFolderText, runsText } from "./status-text.js";

// The Home panel's recent runs (docs/13, Home). The panel holds no state of its own: the widget
// passes the model and a refresh. Text is shown as it is: React escapes it, Markdown is not involved.
// shortcut: inline styles on Theia's own CSS variables; the METE tokens and Baloo 2 of docs/13
// (Design system) come with packages/ui-kit, which is still empty.

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

const when = (iso: string) => new Date(iso).toLocaleString();

const Runs = ({ rows }: { readonly rows: readonly HomeRow[] }) =>
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
							{r.goal}
							{r.templateId ? (
								<span style={MUTED}> · {r.templateId}</span>
							) : null}
						</td>
						<td style={CELL}>{when(r.createdAt)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);

const Body = ({ model }: { readonly model: HomeModel }) => {
	if (model.kind === "loading")
		return (
			<p>{nls.localize("mete/home/loading", "Asking the METE daemon…")}</p>
		);
	if (model.kind === "no_folder") return <p>{noFolderText()}</p>;
	if (model.kind === "failed")
		return <p role="alert">{failureText(model.failure)}</p>;
	return <Runs rows={model.rows} />;
};

/** What the panel draws for a model; `onRefresh` asks the daemon again. */
export const HomeView = ({
	model,
	onRefresh,
}: {
	readonly model: HomeModel;
	readonly onRefresh: () => void;
}) => (
	<section style={PANEL} aria-live="polite">
		<h2 style={{ margin: 0, fontSize: "1.1em" }}>
			{nls.localize("mete/home/recentRuns", "Recent runs")}
		</h2>
		<Body model={model} />
		<div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
			<button type="button" className="theia-button" onClick={onRefresh}>
				{nls.localize("mete/home/refresh", "Refresh")}
			</button>
			{"at" in model ? (
				<span style={MUTED}>
					{nls.localize("mete/home/asOf", "As of {0}", when(model.at))}
				</span>
			) : null}
		</div>
	</section>
);
