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
	skills: "book",
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
	"vsxExtensions.toggle": "extensions",
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
		caption={null}
		actions={
			<button
				type="button"
				className="mete-button quiet icon"
				aria-label={nls.localize("mete/settings/refresh", "Refresh")}
				title={nls.localize("mete/settings/refresh", "Refresh")}
				onClick={onRefresh}
			>
				<Icon name="refresh" />
			</button>
		}
		aside={scope}
	>
		{note}
	</ScreenHero>
);

/** Search stays local to the screen and never changes a setting or its draft. */
export const SettingsSearch = ({
	query,
	onQuery,
}: {
	readonly query: string;
	readonly onQuery: (query: string) => void;
}) => (
	<div className="mete-settings-search">
		<input
			type="search"
			className="mete-field"
			aria-label={nls.localize("mete/settings/search", "Search settings")}
			placeholder={nls.localize("mete/settings/search", "Search settings")}
			value={query}
			onChange={(event) => onQuery(event.target.value)}
		/>
		<button
			type="button"
			className="mete-button quiet icon"
			disabled={!query}
			aria-label={nls.localize("mete/settings/clearSearch", "Clear search")}
			title={nls.localize("mete/settings/clearSearch", "Clear search")}
			onClick={() => onQuery("")}
		>
			<Icon name="clear-all" />
		</button>
	</div>
);

/** An empty search offers a local reset without refreshing or discarding drafts. */
export const NoSettings = ({
	query,
	onReset,
}: {
	readonly query: string;
	readonly onReset: () => void;
}) => (
	<div className="mete-settings-state">
		<p role="status">
			{nls.localize(
				"mete/settings/noResults",
				"No settings match “{0}”.",
				query.trim(),
			)}
		</p>
		<button type="button" className="mete-button quiet" onClick={onReset}>
			{nls.localize("mete/settings/clearSearch", "Clear search")}
		</button>
	</div>
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

/** Category buttons at the left, or a native selector in narrow panels (ADR-180). */
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
		{groups.length > 0 ? (
			<select
				className="mete-field mete-settings-category"
				aria-label={nls.localize("mete/groups/list", "Settings groups")}
				value={chosen?.id ?? ""}
				onChange={(event) => {
					const group = groups.find((g) => g.id === event.currentTarget.value);
					if (group) onGroup(group.id);
				}}
			>
				{groups.map((g) => (
					<option key={g.id} value={g.id}>
						{g.label}
					</option>
				))}
			</select>
		) : null}
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
	readonly error?: string | undefined;
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
		{apply.error ? (
			<span className="mete-save-bar-problem" role="alert">
				{apply.error}
			</span>
		) : null}
	</>
);
