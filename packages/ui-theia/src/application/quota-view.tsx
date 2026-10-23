import { ANY_PROVIDER, type QuotaUnitUsage } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { CSSProperties } from "react";
import type { DaemonFailure } from "../domain/status-service.js";
import { failureText, noFolderText } from "./status-text.js";

// The Quota dashboard (docs/13; ADR-054): the quota pool's units of the folder's daemon, one row
// per provider, unit and model scope, with used, limit and reset time. Inline styles on Theia's CSS
// variables, as the other panels.

/** What the view draws: waiting, no folder, why the daemon gave no units, or the units. */
export type QuotaModel =
	| { readonly kind: "loading" }
	| { readonly kind: "no_folder" }
	| { readonly kind: "failed"; readonly failure: DaemonFailure }
	| { readonly kind: "units"; readonly units: readonly QuotaUnitUsage[] };

const PANEL: CSSProperties = {
	padding: "12px",
	color: "var(--theia-foreground)",
	display: "flex",
	flexDirection: "column",
	gap: "10px",
};
const CELL: CSSProperties = {
	textAlign: "left",
	padding: "4px 6px",
	borderBottom: "1px solid var(--theia-panel-border)",
	verticalAlign: "top",
};
const DASH = "—";

const providerText = (id: string) =>
	id === ANY_PROVIDER
		? nls.localize("mete/quota/anyProvider", "Every paid model")
		: id;

const limitText = (limit: number | null) =>
	limit === null
		? nls.localize("mete/quota/noLimit", "Not known yet")
		: String(limit);

const Rows = ({ units }: { readonly units: readonly QuotaUnitUsage[] }) =>
	units.length === 0 ? (
		<p>
			{nls.localize(
				"mete/quota/noUnits",
				"No quota units yet: a provider's units appear once its models are listed.",
			)}
		</p>
	) : (
		<table style={{ borderCollapse: "collapse", width: "100%" }}>
			<thead>
				<tr>
					{[
						nls.localize("mete/quota/provider", "Provider"),
						nls.localize("mete/quota/unit", "Unit"),
						nls.localize("mete/quota/model", "Model"),
						nls.localize("mete/quota/used", "Used"),
						nls.localize("mete/quota/limit", "Limit"),
						nls.localize("mete/quota/resets", "Resets"),
					].map((h) => (
						<th key={h} scope="col" style={CELL}>
							{h}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{units.map((u) => (
					<tr key={`${u.providerId}/${u.unit}/${u.scope ?? ""}`}>
						<td style={CELL}>{providerText(u.providerId)}</td>
						<td style={CELL}>{u.unit}</td>
						<td style={CELL}>{u.scope ?? DASH}</td>
						<td style={CELL}>{u.used}</td>
						<td style={CELL}>{limitText(u.limit)}</td>
						<td style={CELL}>
							{u.resetsAt ? new Date(u.resetsAt).toLocaleString() : DASH}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);

const Body = ({ model }: { readonly model: QuotaModel }) => {
	if (model.kind === "loading")
		return <p>{nls.localize("mete/quota/loading", "Reading the quota…")}</p>;
	if (model.kind === "no_folder") return <p>{noFolderText()}</p>;
	if (model.kind === "failed")
		return <p role="alert">{failureText(model.failure)}</p>;
	return <Rows units={model.units} />;
};

/** The Quota dashboard for a model, with its Refresh button. */
export const QuotaView = ({
	model,
	onRefresh,
}: {
	readonly model: QuotaModel;
	readonly onRefresh: () => void;
}) => (
	<section style={PANEL} aria-live="polite">
		<Body model={model} />
		<div>
			<button type="button" className="theia-button" onClick={onRefresh}>
				{nls.localize("mete/home/refresh", "Refresh")}
			</button>
		</div>
	</section>
);
