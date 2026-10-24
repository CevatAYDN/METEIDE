import { TierSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { MUTED } from "./look.js";
import { TONES } from "./roster-look.js";
import type { MemberView, TeamView } from "./team-draft.js";
import { tierLabel } from "./team-view.js";

// The members of the team editor as tiles (ADR-093): one per member, the chosen one pressed; its form
// shows beside the grid. A tile says who the member is and whether it has work, never its fields.

const GRID = {
	display: "grid",
	gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
	gap: "8px",
} as const;
const TILE = {
	display: "flex",
	flexDirection: "column",
	gap: "4px",
	textAlign: "left",
	minWidth: 0,
	cursor: "pointer",
	font: "inherit",
	color: "inherit",
} as const;
const AVATAR = {
	display: "inline-grid",
	placeItems: "center",
	width: "28px",
	height: "28px",
	borderRadius: "8px",
	fontWeight: 800,
	color: TONES.accent,
	border: `1.5px solid ${TONES.accent}`,
} as const;
const CLIP = {
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
} as const;

/** What a member's tile says about its work: how many tasks name it. */
const tasksText = (n: number): string =>
	n === 0
		? nls.localize("mete/team/noTask", "No task yet")
		: n === 1
			? nls.localize("mete/team/oneTask", "1 task")
			: nls.localize("mete/team/tasks", "{0} tasks", n);

const tierText = (tier: string): string => {
	const t = TierSchema.safeParse(tier);
	return t.success ? tierLabel(t.data) : tier;
};

const Tile = (props: {
	readonly member: MemberView;
	readonly tasks: number;
	readonly pressed: boolean;
	readonly onSelect: () => void;
}) => {
	const { member } = props;
	const name = member.name || member.id;
	return (
		<button
			type="button"
			className="mete-card"
			style={TILE}
			aria-pressed={props.pressed}
			onClick={props.onSelect}
		>
			<span style={{ display: "flex", gap: "8px", alignItems: "center" }}>
				<span aria-hidden="true" style={AVATAR}>
					{name.slice(0, 1).toUpperCase()}
				</span>
				<strong style={CLIP}>{name}</strong>
			</span>
			<span style={MUTED}>{tierText(member.tier)}</span>
			<span style={{ ...MUTED, ...CLIP }}>{member.goal.split("\n")[0]}</span>
			<span style={MUTED}>{tasksText(props.tasks)}</span>
		</button>
	);
};

/** The grid of member tiles, with Add member as its last tile. */
export const MemberGrid = (props: {
	readonly team: TeamView;
	readonly selected: number;
	readonly onSelect: (index: number) => void;
	readonly onAdd: () => void;
}) => (
	<div style={GRID}>
		{props.team.roles.map((r, i) => (
			<Tile
				// biome-ignore lint/suspicious/noArrayIndexKey: two new members may share an id until the schema refuses it
				key={i}
				member={r}
				tasks={props.team.tasks.filter((t) => t.role === r.id).length}
				pressed={i === props.selected}
				onSelect={() => props.onSelect(i)}
			/>
		))}
		<button
			type="button"
			className="mete-button quiet"
			style={{ minHeight: "72px" }}
			onClick={props.onAdd}
		>
			{nls.localize("mete/team/addMember", "Add member")}
		</button>
	</div>
);
