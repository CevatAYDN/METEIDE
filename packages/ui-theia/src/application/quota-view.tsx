import { ANY_PROVIDER, type QuotaUsage } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { type ReactNode, useState } from "react";
import type { DaemonFailure } from "../domain/status-service.js";
import { Icon } from "./roster-look.js";
import { ScreenHero } from "./screen-hero.js";
import { failureText, noFolderText } from "./status-text.js";

// The Quota dashboard (docs/13; ADR-054): the quota pool's units of the folder's daemon, one row
// per provider, unit and model scope, with used (and a bar of it against the limit), limit, reset
// time and, on request, the history: each amount in the window with its time (ADR-055; a list on a
// rail, not a chart). A provider's units sit under its name. Laid out by style/mete-quota.css.

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

const keyOf = (u: QuotaUsage) => `${u.providerId}/${u.unit}/${u.scope ?? ""}`;

// The units of each provider together, in the order the providers first appear.
const byProvider = (units: readonly QuotaUsage[]) => {
	const groups = new Map<string, QuotaUsage[]>();
	for (const u of units)
		groups.set(u.providerId, [...(groups.get(u.providerId) ?? []), u]);
	return [...groups.values()];
};

// How much of the limit is used, for the bar; a limit not known yet or zero has no bar.
const shareOf = (u: QuotaUsage) =>
	u.limit && u.limit > 0 ? Math.min(100, (u.used / u.limit) * 100) : undefined;

const Used = ({ unit }: { readonly unit: QuotaUsage }) => {
	const share = shareOf(unit);
	return (
		<>
			<span className="mete-quota-used">{unit.used}</span>
			{share === undefined ? null : (
				<span className="mete-quota-meter" aria-hidden="true">
					<span style={{ width: `${share}%` }} />
				</span>
			)}
		</>
	);
};

// The amounts still in the window, oldest first, on a rail.
const Timeline = ({ history }: { readonly history: QuotaUsage["history"] }) => (
	<div className="mete-quota-timeline">
		<ul>
			{history.map((h, i) => (
				// Two amounts can share a time, so the position keeps the key unique.
				// biome-ignore lint/suspicious/noArrayIndexKey: the list is never reordered
				<li key={`${h.at}/${i}`}>
					<time dateTime={h.at}>{new Date(h.at).toLocaleString()}</time>
					<span>{h.amount}</span>
				</li>
			))}
		</ul>
	</div>
);

const HistoryButton = (props: {
	readonly unit: QuotaUsage;
	readonly open: boolean;
	readonly onToggle: () => void;
}) =>
	props.unit.history.length === 0 ? (
		DASH
	) : (
		<button
			type="button"
			className="mete-quota-history"
			aria-expanded={props.open}
			aria-controls={`mete-history-${keyOf(props.unit)}`}
			onClick={props.onToggle}
		>
			<Icon name={props.open ? "chevron-down" : "chevron-right"} />
			{nls.localize(
				"mete/quota/amounts",
				"{0} amount(s)",
				props.unit.history.length,
			)}
		</button>
	);

const UnitRow = (props: {
	readonly unit: QuotaUsage;
	readonly head: ReactNode;
	readonly open: boolean;
	readonly onToggle: () => void;
}) => {
	const { unit } = props;
	return (
		<>
			<tr className={props.open ? "open" : undefined}>
				{props.head}
				<td className="mete-quota-unit">{unit.unit}</td>
				<td
					className={unit.scope ? "mete-quota-model" : "mete-quota-none"}
					title={unit.scope ?? undefined}
				>
					{unit.scope ?? DASH}
				</td>
				<td>
					<Used unit={unit} />
				</td>
				<td
					className={
						unit.limit === null ? "mete-quota-unknown" : "mete-quota-limit"
					}
				>
					{unit.limit === null
						? nls.localize("mete/quota/noLimit", "Not known yet")
						: String(unit.limit)}
				</td>
				<td className={unit.resetsAt ? "mete-quota-reset" : "mete-quota-none"}>
					{unit.resetsAt ? new Date(unit.resetsAt).toLocaleString() : DASH}
				</td>
				<td
					className={unit.history.length === 0 ? "mete-quota-none" : undefined}
				>
					<HistoryButton
						unit={unit}
						open={props.open}
						onToggle={props.onToggle}
					/>
				</td>
			</tr>
			{props.open ? (
				<tr id={`mete-history-${keyOf(unit)}`} className="mete-quota-rail">
					<td colSpan={6}>
						<Timeline history={unit.history} />
					</td>
				</tr>
			) : null}
		</>
	);
};

const Group = (props: {
	readonly units: readonly QuotaUsage[];
	readonly opened: ReadonlySet<string>;
	readonly onToggle: (key: string) => void;
}) => {
	const [first] = props.units;
	if (!first) return null;
	const rows =
		props.units.length +
		props.units.filter((u) => props.opened.has(keyOf(u))).length;
	return (
		<tbody>
			{props.units.map((u, i) => (
				<UnitRow
					key={keyOf(u)}
					unit={u}
					open={props.opened.has(keyOf(u))}
					onToggle={() => props.onToggle(keyOf(u))}
					head={
						i === 0 ? (
							<th
								scope="rowgroup"
								rowSpan={rows}
								className={
									first.providerId === ANY_PROVIDER
										? undefined
										: "mete-quota-id"
								}
							>
								{providerText(first.providerId)}
							</th>
						) : null
					}
				/>
			))}
		</tbody>
	);
};

const Heads = () => (
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
			<th key={h} scope="col">
				{h}
			</th>
		))}
	</tr>
);

const Units = ({
	units,
	opened,
}: {
	readonly units: readonly QuotaUsage[];
	readonly opened: readonly string[];
}) => {
	const [open, setOpen] = useState<ReadonlySet<string>>(new Set(opened));
	const toggle = (key: string) =>
		setOpen((now) => {
			const next = new Set(now);
			if (!next.delete(key)) next.add(key);
			return next;
		});
	if (units.length === 0)
		return (
			<p className="mete-quota-state">
				{nls.localize(
					"mete/quota/noUnits",
					"No quota units yet: a provider's units appear once its models are listed.",
				)}
			</p>
		);
	return (
		<section
			className="mete-table-card mete-quota-card"
			aria-label={nls.localize("mete/quota/units", "Quota units")}
		>
			<table>
				<colgroup>
					<col className="provider" />
					<col className="unit" />
					<col className="model" />
					<col className="used" />
					<col className="limit" />
					<col className="reset" />
					<col />
				</colgroup>
				<thead>
					<Heads />
				</thead>
				{byProvider(units).map((g) => (
					<Group
						key={g[0]?.providerId}
						units={g}
						opened={open}
						onToggle={toggle}
					/>
				))}
			</table>
		</section>
	);
};

const Body = ({
	model,
	opened,
}: {
	readonly model: QuotaModel;
	readonly opened: readonly string[];
}) => {
	if (model.kind === "loading")
		return (
			<p className="mete-quota-state">
				{nls.localize("mete/quota/loading", "Reading the quota…")}
			</p>
		);
	if (model.kind === "no_folder")
		return <p className="mete-quota-state">{noFolderText()}</p>;
	if (model.kind === "failed")
		return (
			<p className="mete-quota-state" role="alert">
				{failureText(model.failure)}
			</p>
		);
	return <Units units={model.units} opened={opened} />;
};

/** The Quota dashboard for a model, with its Refresh button; `opened` names the units whose history shows at first. */
export const QuotaView = ({
	model,
	onRefresh,
	opened = [],
}: {
	readonly model: QuotaModel;
	readonly onRefresh: () => void;
	readonly opened?: readonly string[];
}) => (
	<section className="mete-screen mete-quota" aria-live="polite">
		<ScreenHero
			compact
			icon="dashboard"
			title={nls.localize("mete/quota/title", "Quota")}
			caption={nls.localize(
				"mete/quota/caption",
				"METE: each provider's quota units",
			)}
			actions={
				<button type="button" className="mete-button quiet" onClick={onRefresh}>
					<Icon name="refresh" />
					{nls.localize("mete/home/refresh", "Refresh")}
				</button>
			}
		/>
		<Body model={model} opened={opened} />
	</section>
);
