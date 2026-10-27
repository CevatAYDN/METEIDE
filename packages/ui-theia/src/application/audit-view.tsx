import { type AuditEntry, PolicyActionSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { AuditFilter, DaemonFailure } from "../domain/status-service.js";
import { Icon } from "./roster-look.js";
import { ScreenHero } from "./screen-hero.js";
import { failureText, noFolderText } from "./status-text.js";

// The Audit log view (docs/13; SECURITY.md, Audit log; ADR-053): the workspace's policy decisions,
// newest first, filtered by run, verdict and action, and exported as JSON. Text is shown as it is:
// React escapes it. Laid out by style/mete-audit.css.

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
	<label>
		{label}
		<select
			// A run is named by its goal, which can be long: the box stays a box, the text is cut.
			className={value === undefined ? "mete-field" : "mete-field active"}
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
	<section
		className="mete-audit-filters"
		aria-label={nls.localize("mete/audit/filters", "Filters")}
	>
		<Icon name="filter" />
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
	</section>
);

const VERDICT_ICONS = {
	allow: "check",
	ask: "question",
	deny: "circle-slash",
} as const;

// A verdict in words with its glyph and tone, never a colour alone.
const Verdict = ({ verdict }: { readonly verdict: AuditEntry["verdict"] }) => (
	<span className={`mete-verdict ${verdict}`}>
		<Icon name={VERDICT_ICONS[verdict]} />
		{verdict}
	</span>
);

const Rows = ({ entries }: { readonly entries: readonly AuditEntry[] }) =>
	entries.length === 0 ? (
		<p className="mete-audit-state">
			{nls.localize("mete/audit/none", "No audit rows match these filters.")}
		</p>
	) : (
		<section
			className="mete-table-card mete-audit-card"
			aria-label={nls.localize("mete/audit/title", "Audit log")}
		>
			<table>
				<colgroup>
					<col className="time" />
					<col className="action" />
					<col className="capability" />
					<col className="verdict" />
					<col />
				</colgroup>
				<thead>
					<tr>
						{[
							nls.localize("mete/audit/time", "Time"),
							nls.localize("mete/audit/action", "Action"),
							nls.localize("mete/audit/capability", "Capability"),
							nls.localize("mete/audit/verdict", "Verdict"),
							nls.localize("mete/audit/rule", "Rule"),
						].map((h) => (
							<th key={h} scope="col">
								{h}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{entries.map((e) => (
						<tr key={e.seq}>
							<td className="mete-audit-time">
								{new Date(e.ts).toLocaleString()}
							</td>
							<td className="mete-audit-action">{e.action}</td>
							<td className="mete-audit-dim">{e.capability}</td>
							<td>
								<Verdict verdict={e.verdict} />
							</td>
							<td className="mete-audit-dim">{e.rule}</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	);

const Body = ({ model }: { readonly model: AuditModel }) => {
	if (model.kind === "loading")
		return (
			<p className="mete-audit-state">
				{nls.localize("mete/audit/loading", "Reading the audit log…")}
			</p>
		);
	if (model.kind === "no_folder")
		return <p className="mete-audit-state">{noFolderText()}</p>;
	if (model.kind === "failed")
		return (
			<p className="mete-audit-state" role="alert">
				{failureText(model.failure)}
			</p>
		);
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
	<section className="mete-screen mete-audit" aria-live="polite">
		<ScreenHero
			compact
			icon="shield"
			title={nls.localize("mete/audit/title", "Audit log")}
			caption={nls.localize(
				"mete/audit/caption",
				"METE: the policy's decisions",
			)}
			actions={
				<div className="mete-screen-actions">
					<button
						type="button"
						className="mete-button quiet"
						onClick={controls.onRefresh}
					>
						<Icon name="refresh" />
						{nls.localize("mete/home/refresh", "Refresh")}
					</button>
					<button
						type="button"
						className="mete-button quiet"
						disabled={model.kind !== "rows" || model.entries.length === 0}
						onClick={controls.onExport}
					>
						<Icon name="export" />
						{nls.localize("mete/audit/export", "Export as JSON…")}
					</button>
				</div>
			}
		/>
		<Filters c={controls} />
		<Body model={model} />
	</section>
);
