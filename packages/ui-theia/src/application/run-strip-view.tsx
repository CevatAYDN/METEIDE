import type { TeamView } from "@mete/ui-studio";
import { Icon, LINE, TONES } from "./roster-look.js";
import { type Chip, chipsOf, type RunFacts } from "./run-strip.js";

// The run strip (ADR-094): the run's facts as chips under its goal, in every view of the Team panel.

const CHIPS = {
	display: "flex",
	flexWrap: "wrap",
	gap: "6px",
	padding: 0,
	margin: 0,
	listStyle: "none",
} as const;

const ChipView = ({ chip }: { readonly chip: Chip }) => (
	<li>
		<span
			className="mete-chip"
			style={{ ...LINE, display: "inline-flex" }}
			title={chip.title}
		>
			<span style={{ color: TONES[chip.tone] }}>
				<Icon name={chip.icon} />
			</span>
			{chip.text}
		</span>
	</li>
);

/** The chips of the shown run, or nothing before any fact is known. */
export const RunStrip = (props: {
	readonly facts: RunFacts;
	readonly view: TeamView;
}) => {
	const chips = chipsOf(props.facts, props.view);
	if (chips.length === 0) return null;
	return (
		<ul style={CHIPS}>
			{chips.map((c) => (
				<ChipView key={c.key} chip={c} />
			))}
		</ul>
	);
};
