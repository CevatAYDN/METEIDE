import { type AuditEntry, PolicyActionSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import type { AuditFilter, DaemonFailure } from "../domain/status-service.js";
import { failureText, noFolderText } from "./status-text.js";

// The Audit log view (docs/13; SECURITY.md, Audit log; ADR-053): the workspace's policy decisions,
// newest first, filtered by run, verdict and action, and exported as JSON. Text is shown as it is:
// React escapes it. Inline styles on Theia's CSS variables, as the other panels.

/** What the view draws: waiting, no folder, why the daemon gave no rows, or the rows. */
export type AuditModel =
	| { readonly kind: "loading" }
	| { readonly kind: "no_folder" }
	| { readonly kind: "failed"; readonly failure: DaemonFailure }
	| { readonly kind: "rows"; readonly entries: readonly AuditEntry[] };

/** The filters, the folder's runs to choose from, and what the buttons do. */
export type AuditControls = {
	readonly filter: AuditFilter;
	readonly runs: readonly { readonly id: string; readonly goal: string }[];
	readonly onFilter: (filter: AuditFilter) => void;
	readonly onExport: () => void;
	readonly onRefresh: () => void;
};

/** The JSON an export writes: the entries shown, as the daemon sent them. */
export const auditJson = (entries: readonly AuditEntry[]) =>
	`${JSON.stringify(entries, null, 2)}\n`;

const PANEL: CSSProperties = {
	padding: "12px",
	color: "var(--theia-foreground)",
	display: "flex",
	flexDirection: "column",
	gap: "10px",
};
const ROW: CSSProperties = {
	display: "flex",
	gap: "8px",
	flexWrap: "wrap",
	alignItems: "center",
};
const CELL: CSSProperties = {
	textAlign: "left",
	padding: "4px 6px",
	borderBottom: "1px solid var(--theia-panel-border)",
	verticalAlign: "top",
};
const VERDICTS: readonly AuditEntry["verdict"][] = ["allow", "ask", "deny"];

const Choice = ({
	label,
	value,
	options,
	onChange,
}: {
	readonly label: string;
	readonly value: string | undefined;
	readonly options: readonly {
		readonly value: string;
		readonly text: string;
	}[];
	readonly onChange: (value: string | undefined) => void;
}) => (
	<label style={{ display: "flex", gap: "4px", alignItems: "center" }}>
		{label}
		<select
			className="theia-select"
			value={value ?? ""}
			onChange={(e) => onChange(e.target.value || undefined)}
		>
			<option value="">{nls.localize("mete/audit/any", "Any")}</option>
			{options.map((o) => (
				<option key={o.value} value={o.value}>
					{o.text}
				</option>
			))}
		</select>
	</label>
);

// The filter with one field changed; an empty choice leaves it out.
const withField = <K extends keyof AuditFilter>(
	f: AuditFilter,
	key: K,
	value: AuditFilter[K] | undefined,
): AuditFilter => {
	const { [key]: _, ...rest } = f;
	return value === undefined ? rest : { ...rest, [key]: value };
};

const Filters = ({ c }: { readonly c: AuditControls }) => (
	<div style={ROW}>
		<Choice
			label={nls.localize("mete/audit/run", "Run")}
			value={c.filter.runId}
			options={c.runs.map((r) => ({ value: r.id, text: r.goal }))}
			onChange={(v) => c.onFilter(withField(c.filter, "runId", v))}
		/>
		<Choice
			label={nls.localize("mete/audit/verdict", "Verdict")}
			value={c.filter.verdict}
			options={VERDICTS.map((v) => ({ value: v, text: v }))}
			onChange={(v) =>
				c.onFilter(
					withField(
						c.filter,
						"verdict",
						v as AuditEntry["verdict"] | undefined,
					),
				)
			}
		/>
		<Choice
			label={nls.localize("mete/audit/action", "Action")}
			value={c.filter.action}
			options={PolicyActionSchema.options.map((a) => ({ value: a, text: a }))}
			onChange={(v) =>
				c.onFilter(
					withField(c.filter, "action", v as AuditEntry["action"] | undefined),
				)
			}
		/>
	</div>
);

const Rows = ({ entries }: { readonly entries: readonly AuditEntry[] }) =>
	entries.length === 0 ? (
		<p>
			{nls.localize("mete/audit/none", "No audit rows match these filters.")}
		</p>
	) : (
		<table style={{ borderCollapse: "collapse", width: "100%" }}>
			<thead>
				<tr>
					{[
						nls.localize("mete/audit/time", "Time"),
						nls.localize("mete/audit/action", "Action"),
						nls.localize("mete/audit/capability", "Capability"),
						nls.localize("mete/audit/verdict", "Verdict"),
						nls.localize("mete/audit/rule", "Rule"),
					].map((h) => (
						<th key={h} scope="col" style={CELL}>
							{h}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{entries.map((e) => (
					<tr key={e.seq}>
						<td style={CELL}>{new Date(e.ts).toLocaleString()}</td>
						<td style={CELL}>{e.action}</td>
						<td style={CELL}>{e.capability}</td>
						<td style={CELL}>{e.verdict}</td>
						<td style={CELL}>{e.rule}</td>
					</tr>
				))}
			</tbody>
		</table>
	);

const Body = ({ model }: { readonly model: AuditModel }) => {
	if (model.kind === "loading")
		return (
			<p>{nls.localize("mete/audit/loading", "Reading the audit log…")}</p>
		);
	if (model.kind === "no_folder") return <p>{noFolderText()}</p>;
	if (model.kind === "failed")
		return <p role="alert">{failureText(model.failure)}</p>;
	return <Rows entries={model.entries} />;
};

/** The Audit log view for a model, with its filters and buttons. */
export const AuditView = ({
	model,
	controls,
}: {
	readonly model: AuditModel;
	readonly controls: AuditControls;
}) => (
	<section style={PANEL} aria-live="polite">
		<Filters c={controls} />
		<Body model={model} />
		<div style={ROW}>
			<button
				type="button"
				className="theia-button"
				onClick={controls.onRefresh}
			>
				{nls.localize("mete/home/refresh", "Refresh")}
			</button>
			<button
				type="button"
				className="theia-button secondary"
				disabled={model.kind !== "rows" || model.entries.length === 0}
				onClick={controls.onExport}
			>
				{nls.localize("mete/audit/export", "Export as JSON…")}
			</button>
		</div>
	</section>
);
