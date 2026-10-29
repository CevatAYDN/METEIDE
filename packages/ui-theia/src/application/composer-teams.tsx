import { nls } from "@theia/core/lib/common/nls";
import { useId } from "react";
import type { ComposerOption } from "./composer.js";
import type { EstimateLine } from "./estimate-text.js";
import { Icon } from "./roster-look.js";

// The composer's teams in the Composer board's look (ADR-128): a heading with New team over a grid
// of cards, Let METE choose and Single agent across it. A team's Edit opens the team editor
// (ADR-075); a button inside a label is not valid HTML, so it is the label's sibling in the card.
// Laid out by style/mete-composer.css.

// A template has no icon of its own, so every team shares one; the board's per-team icons would
// need a field in the template contract.
const iconOf = (o: ComposerOption) =>
	o.templateId === undefined
		? "compass"
		: o.templateId === null
			? "person"
			: "organization";

// The board's estimate: the total, a chip per share, the one no provider takes marked, then the note.
const Estimate = ({ line }: { readonly line: EstimateLine }) => (
	<span className="mete-composer-estimate">
		<span className="mete-composer-total">{line.total}</span>
		{line.shares.map((s) => (
			<span
				key={s.text}
				className={
					s.unassigned
						? "mete-composer-share unassigned"
						: "mete-composer-share"
				}
			>
				{s.text}
			</span>
		))}
		{line.note ? <span className="mete-composer-note">{line.note}</span> : null}
	</span>
);

const Card = ({
	option,
	checked,
	onSelect,
}: {
	readonly option: ComposerOption;
	readonly checked: boolean;
	readonly onSelect: (key: string) => void;
}) => (
	<label
		className={`mete-card mete-composer-option${typeof option.templateId === "string" ? "" : " wide"}`}
	>
		<span className="mete-composer-head">
			<input
				type="radio"
				name="mete-team"
				checked={checked}
				onChange={() => onSelect(option.key)}
			/>
			<span className="mete-composer-tile">
				<Icon name={iconOf(option)} />
			</span>
			<strong>{option.label}</strong>
		</span>
		{option.description ? (
			<span className="mete-composer-about">{option.description}</span>
		) : null}
		{option.estimate ? <Estimate line={option.estimate} /> : null}
	</label>
);

const Option = (props: {
	readonly option: ComposerOption;
	readonly checked: boolean;
	readonly onSelect: (key: string) => void;
	readonly onEdit: (templateId: string) => void;
}) => {
	const id = props.option.templateId;
	if (typeof id !== "string") return <Card {...props} />;
	return (
		<div className="mete-composer-team">
			<Card {...props} />
			<button
				type="button"
				className="mete-button quiet mete-composer-edit"
				aria-label={nls.localize(
					"mete/team/editNamed",
					"Edit {0}",
					props.option.label,
				)}
				onClick={() => props.onEdit(id)}
			>
				<Icon name="edit" />
				{nls.localize("mete/team/editShort", "Edit")}
			</button>
		</div>
	);
};

/** The teams to pick from, each with its estimate, under a heading with New team. */
export const Teams = (props: {
	readonly options: readonly ComposerOption[];
	/** The router was unsure: the list holds its suggestions and a single agent. */
	readonly unsure: boolean;
	readonly selected: string;
	readonly onSelect: (key: string) => void;
	readonly onEdit: (templateId: string) => void;
	readonly onNewTeam: () => void;
}) => {
	const title = useId();
	return (
		<section className="mete-composer-teams">
			<div className="mete-composer-teams-head">
				<h3 id={title}>
					{nls.localize("mete/run/pickStart", "Which team should work on it?")}
				</h3>
				<button
					type="button"
					className="mete-button quiet"
					onClick={props.onNewTeam}
				>
					<Icon name="add" />
					{nls.localize("mete/team/new", "New team")}
				</button>
			</div>
			{props.unsure ? (
				<p role="status">
					{nls.localize(
						"mete/run/pickTeam",
						"METE is not sure which team fits this goal; choose one",
					)}
				</p>
			) : null}
			<div
				className="mete-composer-grid"
				role="radiogroup"
				aria-labelledby={title}
			>
				{props.options.map((o) => (
					<Option
						key={o.key}
						option={o}
						checked={o.key === props.selected}
						onSelect={props.onSelect}
						onEdit={props.onEdit}
					/>
				))}
			</div>
		</section>
	);
};
