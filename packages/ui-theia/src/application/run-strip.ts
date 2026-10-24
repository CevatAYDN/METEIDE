import type { TeamView } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import { roleWords } from "../domain/roster.js";
import type { StatusRuns } from "../domain/status-service.js";
import { tokenCount } from "./context-meter.js";
import type { Tone } from "./roster-look.js";
import { shortWhen } from "./runs-list.js";
import { optionLabel } from "./settings-form.js";

// The run strip's chips (ADR-094): facts the run already has, as an icon, a word and a tone. The run's
// own entry of `mete/status` gives its status, team, times, autonomy and limits; the fold of its events
// gives the tokens, the calls and the checkpoints. Times are absolute, never a ticking clock (ADR-092).

/** One chip of the strip. */
export type Chip = {
	readonly key: string;
	readonly icon: string;
	readonly text: string;
	readonly tone: Tone;
	/** The whole time or a longer reading, for the tooltip. */
	readonly title?: string;
};

/** What the panel has asked of the daemon for the shown run. */
export type RunFacts = {
	readonly run?: RunEntry;
	/** The team's name from its team file, when that was read. */
	readonly teamName?: string;
};

/** A run as `mete/status` answers it. */
export type RunEntry = StatusRuns[number];

type Status = RunEntry["status"];

const STATUS: Readonly<
	Record<Status, () => Pick<Chip, "icon" | "text" | "tone">>
> = {
	queued: () => ({
		icon: "clock",
		text: nls.localize("mete/strip/queued", "Queued"),
		tone: "muted",
	}),
	running: () => ({
		icon: "play",
		text: nls.localize("mete/strip/running", "Running"),
		tone: "accent",
	}),
	paused: () => ({
		icon: "debug-pause",
		text: nls.localize("mete/strip/paused", "Paused"),
		tone: "warn",
	}),
	completed: () => ({
		icon: "pass",
		text: nls.localize("mete/strip/completed", "Done"),
		tone: "good",
	}),
	failed: () => ({
		icon: "error",
		text: nls.localize("mete/strip/failed", "Failed"),
		tone: "bad",
	}),
	cancelled: () => ({
		icon: "circle-slash",
		text: nls.localize("mete/strip/cancelled", "Cancelled"),
		tone: "muted",
	}),
};

/** How long a run took, in minutes and hours; a still reading, since the run is over. */
export const tookText = (ms: number): string => {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 1)
		return nls.localize("mete/strip/tookShort", "took under a minute");
	if (minutes < 60)
		return nls.localize("mete/strip/tookMinutes", "took {0} min", minutes);
	return nls.localize(
		"mete/strip/tookHours",
		"took {0} h {1} min",
		Math.floor(minutes / 60),
		minutes % 60,
	);
};

const teamChip = (facts: RunFacts, run: RunEntry): Chip => ({
	key: "team",
	icon: "organization",
	tone: "muted",
	text:
		run.templateId === null
			? nls.localize("mete/strip/singleAgent", "Single agent")
			: (facts.teamName ?? roleWords(run.templateId)),
});

const timeChips = (run: RunEntry, now: Date): Chip[] => {
	const at = run.startedAt ?? run.createdAt;
	const started: Chip = {
		key: "started",
		icon: "calendar",
		tone: "muted",
		text: nls.localize("mete/strip/started", "started {0}", shortWhen(at, now)),
		title: new Date(at).toLocaleString(),
	};
	if (!run.endedAt) return [started];
	return [
		started,
		{
			key: "took",
			icon: "watch",
			tone: "muted",
			text: tookText(Date.parse(run.endedAt) - Date.parse(at)),
		},
	];
};

const ruleChips = (run: RunEntry): Chip[] => [
	{
		key: "autonomy",
		icon: "shield",
		tone: "muted",
		text: nls.localize(
			"mete/strip/autonomy",
			"Autonomy {0}",
			optionLabel(run.autonomyLevel),
		),
	},
	{
		key: "limits",
		icon: "dashboard",
		tone: "muted",
		text: nls.localize(
			"mete/strip/limits",
			"up to {0} requests, {1} h",
			run.budget.cloudRequests,
			run.budget.maxHours,
		),
	},
];

// The tokens and calls the run's agents reported (ADR-090), and the checkpoints saved so far.
const foldChips = (view: TeamView): Chip[] => {
	const used = view.agents.flatMap((a) => (a.usage ? [a.usage] : []));
	const calls = used.reduce((n, u) => n + u.calls, 0);
	const checkpoints = view.checkpoints.length;
	return [
		...(calls > 0
			? [
					{
						key: "usage",
						icon: "pulse",
						tone: "muted" as const,
						text: nls.localize(
							"mete/strip/usage",
							"{0} calls · {1} tokens",
							calls,
							tokenCount(used.reduce((n, u) => n + u.tokens, 0)),
						),
					},
				]
			: []),
		...(checkpoints > 0
			? [
					{
						key: "checkpoints",
						icon: "history",
						tone: "muted" as const,
						text:
							checkpoints === 1
								? nls.localize("mete/strip/oneCheckpoint", "1 checkpoint")
								: nls.localize(
										"mete/strip/checkpoints",
										"{0} checkpoints",
										checkpoints,
									),
					},
				]
			: []),
	];
};

/** The strip's chips for the run's facts and its folded events; those the run's entry gives wait for it. */
export const chipsOf = (
	facts: RunFacts,
	view: TeamView,
	now = new Date(),
): Chip[] => {
	const { run } = facts;
	return [
		...(run
			? [
					{ key: "status", ...STATUS[run.status]() },
					teamChip(facts, run),
					...timeChips(run, now),
					...ruleChips(run),
				]
			: []),
		...foldChips(view),
	];
};
