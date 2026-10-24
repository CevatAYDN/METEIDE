import { nls } from "@theia/core/lib/common/nls";

// The Settings screen's groups (ADR-095): plain-words labels over the sections that exist, as the tier
// labels of ADR-089 are over tier ids. A group says which sections it holds and which links it leads
// to; a section no group names falls into Other files, so none is dropped.

/** A group of the Settings screen. */
export type GroupId =
	| "models"
	| "limits"
	| "privacy"
	| "tools"
	| "teams"
	| "look"
	| "other";

/** A link the Settings screen offers: a palette command by id and its label. */
export type SettingsLink = readonly [id: string, label: () => string];

/** The commands the screen leads to: METE's own and Theia's (their ids are Theia's, 1.76). */
export const SETTINGS_LINKS: readonly SettingsLink[] = [
	[
		"mete.team.edit",
		() => nls.localize("mete/settings/editTeam", "Edit team…"),
	],
	["mete.team.new", () => nls.localize("mete/team/new", "New team")],
	[
		"mete.key.set",
		() => nls.localize("mete/settings/setKey", "Set provider key…"),
	],
	[
		"preferences:open",
		() => nls.localize("mete/settings/preferences", "Preferences"),
	],
	[
		"workbench.action.configureLanguage",
		() => nls.localize("mete/settings/language", "Display language"),
	],
];

/** What a group is: its words, the sections it holds and the links it leads to. */
export type GroupDef = {
	readonly id: Exclude<GroupId, "other">;
	readonly label: () => string;
	readonly hint: () => string;
	readonly sections: readonly string[];
	readonly links: readonly string[];
};

/** The groups in the order the list shows them. */
export const GROUPS: readonly GroupDef[] = [
	{
		id: "models",
		label: () => nls.localize("mete/groups/models", "Models and keys"),
		hint: () =>
			nls.localize(
				"mete/groups/modelsHint",
				"Providers, endpoints and which models METE may use",
			),
		sections: ["providers", "gateway", "models", "quota"],
		links: ["mete.key.set"],
	},
	{
		id: "limits",
		label: () =>
			nls.localize("mete/groups/limits", "What the team may do alone"),
		hint: () =>
			nls.localize(
				"mete/groups/limitsHint",
				"When to ask you first, and how much a run may use",
			),
		sections: ["policy"],
		links: [],
	},
	{
		id: "privacy",
		label: () => nls.localize("mete/groups/privacy", "Privacy"),
		hint: () =>
			nls.localize(
				"mete/groups/privacyHint",
				"Whether providers may train on your prompts",
			),
		sections: ["privacy", "workspace"],
		links: [],
	},
	{
		id: "tools",
		label: () => nls.localize("mete/groups/tools", "Tools and web search"),
		hint: () =>
			nls.localize(
				"mete/groups/toolsHint",
				"Adapters, MCP servers and the shell",
			),
		sections: ["bindings", "mcp", "shell"],
		links: [],
	},
	{
		id: "teams",
		label: () => nls.localize("mete/groups/teams", "Teams"),
		hint: () =>
			nls.localize("mete/groups/teamsHint", "Change a team or start a new one"),
		sections: [],
		links: ["mete.team.edit", "mete.team.new"],
	},
	{
		id: "look",
		label: () => nls.localize("mete/groups/look", "Look and language"),
		hint: () =>
			nls.localize("mete/groups/lookHint", "Theme, fonts and display language"),
		sections: [],
		links: ["preferences:open", "workbench.action.configureLanguage"],
	},
];

// Each section's card title (ADR-095): what the section holds, in the words of the doc that defines it.
const TITLES: Readonly<Record<string, () => string>> = {
	// ADR-087: the custom endpoints.
	providers: () => nls.localize("mete/section/providers", "Custom endpoints"),
	// ADR-082: which models, free, paid or both, and the daily spend.
	gateway: () => nls.localize("mete/section/gateway", "Models and daily spend"),
	// docs/09: the user's model rows, merged over the shipped list.
	models: () => nls.localize("mete/section/models", "Your model list"),
	// docs/09, Quota: a limit per provider unit.
	quota: () => nls.localize("mete/section/quota", "Quota limits"),
	// SECURITY.md: autonomy, what asks first, what is never allowed, the budget.
	policy: () => nls.localize("mete/section/policy", "Approvals and limits"),
	// docs/09, Privacy: allowTraining.
	privacy: () =>
		nls.localize("mete/section/privacy", "Training on your prompts"),
	// docs/09, Privacy: the folder's sensitivity.
	workspace: () => nls.localize("mete/section/workspace", "Sensitive folder"),
	// docs/10: the adapters bound to each capability.
	bindings: () => nls.localize("mete/section/bindings", "Tool adapters"),
	// docs/10, MCP client.
	mcp: () => nls.localize("mete/section/mcp", "MCP servers"),
	// docs/10, Built-in tools: PowerShell or Git Bash on Windows.
	shell: () => nls.localize("mete/section/shell", "Which shell"),
};

/** A section's plain-words title, or undefined for a section METE has no words for. */
export const sectionTitle = (name: string): string | undefined =>
	Object.hasOwn(TITLES, name) ? TITLES[name]?.() : undefined;

/** A section as the groups see it: its name, and whether this folder's own file sets it. */
export type GroupedSection = {
	readonly name: string;
	readonly workspace?: unknown;
};

/** One group of the list, with the sections it holds now. */
export type Group<S extends GroupedSection> = {
	readonly id: GroupId;
	readonly label: string;
	readonly hint: string;
	readonly sections: readonly S[];
	readonly links: readonly string[];
	/** Whether a section of it has a value in this folder's own file. */
	readonly changedHere: boolean;
};

/** The groups for the sections the screen shows; Other files appears only when a section needs it. */
export const groupsOf = <S extends GroupedSection>(
	sections: readonly S[],
): Group<S>[] => {
	const named = new Set(GROUPS.flatMap((g) => g.sections));
	const own = (names: readonly string[]) =>
		sections.filter((s) => names.includes(s.name));
	const groups: Group<S>[] = GROUPS.map((g) => {
		const held = own(g.sections);
		return {
			id: g.id,
			label: g.label(),
			hint: g.hint(),
			sections: held,
			links: g.links,
			changedHere: held.some((s) => s.workspace !== undefined),
		};
	});
	const other = sections.filter((s) => !named.has(s.name));
	return other.length === 0
		? groups
		: [
				...groups,
				{
					id: "other",
					label: nls.localize("mete/groups/other", "Other files"),
					hint: nls.localize(
						"mete/groups/otherHint",
						"Sections no group above holds",
					),
					sections: other,
					links: [],
					changedHere: other.some((s) => s.workspace !== undefined),
				},
			];
};
