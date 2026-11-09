import { Command } from "@theia/core";
import type { GroupId } from "./settings-groups.js";

/** Opens Settings without refreshing an existing draft. */
export const SHOW_SETTINGS_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.settings.show", category: "METE", label: "Show settings" },
	"mete/settings/show",
	"mete/category",
);

/** Opens the project/global permission rules in Settings. */
export const SHOW_PERMISSIONS_COMMAND: Command = Command.toLocalizedCommand(
	{
		id: "mete.settings.permissions",
		category: "METE",
		label: "Open permissions",
	},
	"mete/settings/openPermissions",
	"mete/category",
);

/** Opens local skill management without starting discovery or a model call. */
export const SHOW_SKILLS_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.settings.skills", category: "METE", label: "Open skills" },
	"mete/settings/openSkills",
	"mete/category",
);

/** Opens the existing team-management entry points. */
export const SHOW_TEAMS_COMMAND: Command = Command.toLocalizedCommand(
	{ id: "mete.settings.teams", category: "METE", label: "Manage teams" },
	"mete/settings/manageTeams",
	"mete/category",
);

/** Fixed routes avoid accepting arbitrary group ids from command arguments. */
export const SETTINGS_ROUTES: readonly (readonly [
	Command,
	GroupId | undefined,
])[] = [
	[SHOW_SETTINGS_COMMAND, undefined],
	[SHOW_PERMISSIONS_COMMAND, "limits"],
	[SHOW_SKILLS_COMMAND, "skills"],
	[SHOW_TEAMS_COMMAND, "teams"],
];
