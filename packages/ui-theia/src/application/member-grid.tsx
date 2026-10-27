import { TierSchema } from "@mete/contracts";
import { nls } from "@theia/core/lib/common/nls";
import { TIER_ICONS, tierLabel } from "./member-look.js";
import { Icon } from "./roster-look.js";
import type { MemberView, TeamView } from "./team-draft.js";

// The members of the team editor as tiles (ADR-093): one per member, the chosen one pressed; its form
// shows beside the grid. A tile says who the member is and whether it has work, never its fields.
// Laid out by style/mete-team-members.css.

/** What a member's tile says about its work: how many tasks name it. */
const tasksText = (n: number): string =>
	n === 0
		? nls.localize("mete/team/noTask", "No task yet")
		: n === 1
			? nls.localize("mete/team/oneTask", "1 task")
			: nls.localize("mete/team/tasks", "{0} tasks", n);

// The lenient draft may hold a tier the schema refuses: it shows as written, without a glyph.
const Tier = ({ tier }: { readonly tier: string }) => {
	const t = TierSchema.safeParse(tier);
	return (
		<span className="mete-member-tier">
			{t.success ? <Icon name={TIER_ICONS[t.data]} /> : null}
			{t.success ? tierLabel(t.data) : tier}
		</span>
	);
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
			className="mete-member-tile"
			aria-pressed={props.pressed}
			onClick={props.onSelect}
		>
			<span className="mete-member-head">
				<span className="mete-member-face" aria-hidden="true">
					<span>{name.slice(0, 1).toUpperCase()}</span>
				</span>
				<span className="mete-member-who">
					<strong>{name}</strong>
					<Tier tier={member.tier} />
				</span>
			</span>
			<span className="mete-member-goal">{member.goal.split("\n")[0]}</span>
			<span
				className={
					props.tasks === 0 ? "mete-member-count none" : "mete-member-count"
				}
			>
				{tasksText(props.tasks)}
			</span>
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
	<div className="mete-member-grid">
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
		<button type="button" className="mete-member-add" onClick={props.onAdd}>
			<Icon name="add" />
			{nls.localize("mete/team/addMember", "Add member")}
		</button>
	</div>
);
