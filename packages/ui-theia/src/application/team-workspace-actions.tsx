import { nls } from "@theia/core/lib/common/nls";
import { Icon } from "./roster-look.js";
import {
	SHOW_PERMISSIONS_COMMAND,
	SHOW_SKILLS_COMMAND,
} from "./settings-commands.js";

const links = () => [
	{
		id: SHOW_SKILLS_COMMAND.id,
		icon: "book",
		label: nls.localize("mete/groups/skills", "Skills"),
	},
	{
		id: SHOW_PERMISSIONS_COMMAND.id,
		icon: "shield",
		label: nls.localize("mete/team/projectPermissions", "Project permissions"),
	},
	{
		id: "mete.memory.open",
		icon: "history",
		label: nls.localize("mete/memory/title", "Memory"),
	},
];

/** Workspace controls remain user actions, not edits to a team's draft. */
export const TeamWorkspaceActions = ({
	busy,
	onCommand,
}: {
	readonly busy: boolean;
	readonly onCommand: (id: string) => void;
}) => (
	<nav
		className="mete-team-workspace-actions"
		aria-label={nls.localize("mete/team/workspaceActions", "Team workspace")}
	>
		{links().map(({ id, icon, label }) => (
			<button
				key={id}
				type="button"
				className="mete-button quiet"
				disabled={busy}
				onClick={() => {
					if (!busy) onCommand(id);
				}}
			>
				<Icon name={icon} />
				{label}
			</button>
		))}
	</nav>
);
