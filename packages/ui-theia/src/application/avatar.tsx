import type { MemberState } from "../domain/roster.js";
import { Icon } from "./roster-look.js";
import { stateLook } from "./team-view.js";
import { toneStyle } from "./tone.js";

// The initial tile (ADR-127): a role's initial in a ring of its state's tone, the state in the corner,
// three dots while its model thinks, the state's icon otherwise and nothing while idle. It is
// decorative: the member's name and state are always written beside it. Look: style/mete-avatar.css.

const Badge = ({ state }: { readonly state: MemberState }) => {
	if (state.kind === "idle") return null;
	if (state.kind === "thinking")
		return (
			<span className="mete-avatar-badge mete-dots">
				<i />
				<i />
				<i />
			</span>
		);
	return (
		<span className="mete-avatar-badge">
			<Icon name={stateLook(state).icon} />
		</span>
	);
};

/** A member's initial tile in its state. */
export const Avatar = ({
	name,
	state,
}: {
	readonly name: string;
	readonly state: MemberState;
}) => (
	<span
		className="mete-avatar"
		data-state={state.kind}
		style={toneStyle(stateLook(state).tone)}
		aria-hidden="true"
	>
		<span className="mete-avatar-face">{name.charAt(0).toUpperCase()}</span>
		<Badge state={state} />
	</span>
);
