import { nls } from "@theia/core/lib/common/nls";
import type { ReactNode } from "react";
import { Icon } from "./roster-look.js";
import { ScreenHero } from "./screen-hero.js";
import { type Group, type GroupId, SETTINGS_LINKS } from "./settings-groups.js";
import type { Section } from "./settings-section.js";

// The Settings screen's frame in the design set's look (ADR-128): the hero band, the list of groups
// at the left, the chosen group's heading with its links, and Apply now for the save bar. Laid out by
// style/mete-settings.css.

const GROUP_ICONS: Readonly<Record<GroupId, string>> = {
	models: "chip",
	limits: "workspace-trusted",
	privacy: "lock",
	tools: "tools",
	teams: "organization",
	look: "symbol-color",
	other: "file",
};

const LINK_ICONS: Readonly<Record<string, string>> = {
	"mete.team.edit": "edit",
	"mete.team.new": "add",
	"mete.key.set": "key",
	"preferences:open": "settings-gear",
	"workbench.action.configureLanguage": "globe",
};

/** The hero band: the title and caption with Refresh, then the loaded screen's note and scope switch. */
export const Hero = ({
	onRefresh,
	note,
	scope,
}: {
	readonly onRefresh: () => void;
	readonly note?: ReactNode;
	readonly scope?: ReactNode;
}) => (
	<ScreenHero
		icon="settings"
		title={nls.localize("mete/settings/title", "Settings")}
		caption={nls.localize(
			"mete/settings/caption",
			"METE: the configuration it loaded",
		)}
		actions={
			<button type="button" className="mete-button quiet" onClick={onRefresh}>
				<Icon name="refresh" />
				{nls.localize("mete/settings/refresh", "Refresh")}
			</button>
		}
		aside={scope}
	>
		{note}
	</ScreenHero>
);

const GroupItem = ({
	group,
	chosen,
	onChoose,
}: {
	readonly group: Group<Section>;
	readonly chosen: boolean;
	readonly onChoose: () => void;
}) => {
	const here = nls.localize(
		"mete/groups/changedHere",
		"A value of this group is set for this folder only",
	);
	return (
		<button
			type="button"
			className="mete-settings-group"
			aria-pressed={chosen}
			onClick={onChoose}
		>
			<span className="mete-settings-group-tile">
				<Icon name={GROUP_ICONS[group.id]} />
			</span>
			<span className="mete-settings-group-text">
				<strong>
					{group.label}
					{group.changedHere ? (
						<span
							role="img"
							className="mete-settings-dot"
							title={here}
							aria-label={here}
						/>
					) : null}
				</strong>
				<span>{group.hint}</span>
			</span>
		</button>
	);
};

/** The list of groups at the left, the chosen one pressed (ADR-095). */
export const GroupList = ({
	groups,
	chosen,
	onGroup,
}: {
	readonly groups: readonly Group<Section>[];
	readonly chosen?: Group<Section> | undefined;
	readonly onGroup: (group: GroupId) => void;
}) => (
	<nav
		className="mete-settings-nav"
		aria-label={nls.localize("mete/groups/list", "Settings groups")}
	>
		{groups.map((g) => (
			<GroupItem
				key={g.id}
				group={g}
				chosen={g.id === chosen?.id}
				onChoose={() => onGroup(g.id)}
			/>
		))}
	</nav>
);

/** The chosen group's title, with the commands it leads to at the right. */
export const GroupHead = ({
	group,
	onCommand,
}: {
	readonly group: Group<Section>;
	readonly onCommand: (id: string) => void;
}) => (
	<div className="mete-settings-head">
		<h3>{group.label}</h3>
		{SETTINGS_LINKS.filter(([id]) => group.links.includes(id)).map(
			([id, label]) => (
				<button
					type="button"
					key={id}
					className="mete-button quiet"
					onClick={() => onCommand(id)}
				>
					{LINK_ICONS[id] ? <Icon name={LINK_ICONS[id]} /> : null}
					{label()}
				</button>
			),
		)}
	</div>
);

/** Apply now (ADR-083): in flight, and how many runs of the folder are queued or running. */
export type ApplyState = {
	readonly busy: boolean;
	readonly activeRuns: number;
};

/** Apply now; a restart pauses a running run (ADR-061), so it waits, with the reason, until none runs. */
export const ApplyNow = ({
	apply,
	onApply,
}: {
	readonly apply: ApplyState;
	readonly onApply: () => void;
}) => (
	<>
		<button
			type="button"
			className="mete-button quiet"
			disabled={apply.busy || apply.activeRuns > 0}
			onClick={onApply}
		>
			<Icon name="debug-restart" spin={apply.busy} />
			{apply.busy
				? nls.localize("mete/settings/applying", "Restarting METE…")
				: nls.localize("mete/settings/apply", "Apply now")}
		</button>
		{apply.activeRuns > 0 ? (
			<span className="mete-save-bar-reason">
				{nls.localize(
					"mete/settings/applyWaits",
					"A run is running; Apply now waits until it is paused or ends.",
				)}
			</span>
		) : null}
	</>
);
