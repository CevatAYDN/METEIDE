import { ANY_PROVIDER, type QuotaUsage } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import type { DaemonFailure } from "../domain/status-service.js";
import { CELL, PANEL } from "./look.js";
import { failureText, noFolderText } from "./status-text.js";

// The Quota dashboard (docs/13; ADR-054): the quota pool's units of the folder's daemon, one row
// per provider, unit and model scope, with used, limit, reset time and, on request, the history:
// each amount in the window with its time (ADR-055; a list, not a chart). Inline styles on Theia's
// CSS variables, as the other panels.

/** What the view draws: waiting, no folder, why the daemon gave no units, or the units. */
export type QuotaModel =
	| { readonly kind: "loading" }
	| { readonly kind: "no_folder" }
	| { readonly kind: "failed"; readonly failure: DaemonFailure }
	| { readonly kind: "units"; readonly units: readonly QuotaUsage[] };

const DASH = "—";

const providerText = (id: string) =>
	id === ANY_PROVIDER
		? nls.localize("mete/quota/anyProvider", "Every paid model")
		: id;

const limitText = (limit: number | null) =>
	limit === null
		? nls.localize("mete/quota/noLimit", "Not known yet")
		: String(limit);

// The amounts still in the window, oldest first, folded under their count.
const History = ({ history }: { readonly history: QuotaUsage["history"] }) =>
	history.length === 0 ? (
		DASH
	) : (
		<details>
			<summary>
				{nls.localize("mete/quota/amounts", "{0} amount(s)", history.length)}
			</summary>
			<ul style={{ margin: 0, paddingLeft: "16px" }}>
				{history.map((h, i) => (
					// Two amounts can share a time, so the position keeps the key unique.
					// biome-ignore lint/suspicious/noArrayIndexKey: the list is never reordered
					<li key={`${h.at}/${i}`}>
						{new Date(h.at).toLocaleString()} — {h.amount}
					</li>
				))}
			</ul>
		</details>
	);

const Rows = ({ units }: { readonly units: readonly QuotaUsage[] }) =>
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
						nls.localize("mete/quota/history", "History"),
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
						<td style={CELL}>
							<History history={u.history} />
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
			<button type="button" className="mete-button" onClick={onRefresh}>
				{nls.localize("mete/home/refresh", "Refresh")}
			</button>
		</div>
	</section>
);
