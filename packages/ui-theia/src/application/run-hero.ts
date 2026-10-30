import type { ProviderState } from "@mete/contracts";
import type { TeamView } from "@mete/ui-studio";
import { nls } from "@theia/core/lib/common/nls";
import { roleWords } from "../domain/roster.js";
import type { StatusRuns } from "../domain/status-service.js";
import { optionLabel } from "./labels.js";
import { tokenCount } from "./numbers.js";
import { statusTone, statusWord } from "./status-text.js";
import { shortWhen } from "./time-text.js";
import type { Tone } from "./tone.js";

// The hero band's facts (ADR-094, ADR-127): the run's own entry of `mete/status` gives its status, team,
// times, autonomy and limits; the fold of its events gives the calls, the tokens, the checkpoints and a
// team's progress. Times are absolute, never a ticking clock (ADR-092).

/** What the panel has asked of the daemon for the shown run. */
export type RunFacts = {
	readonly run?: RunEntry;
	/** The team's name from its team file, when that was read. */
	readonly teamName?: string;
	/** Why each provider cannot carry the run on now, asked while it is paused for quota (ADR-050). */
	readonly blocked?: readonly ProviderState[];
};

/** A run as `mete/status` answers it. */
export type RunEntry = StatusRuns[number];

type Status = RunEntry["status"];

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

/** How long an ended run was paused, from a minute on (ADR-139); nothing for less. */
export const pausedText = (ms: number): string | undefined => {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 1) return undefined;
	if (minutes < 60)
		return nls.localize("mete/strip/pausedMinutes", "paused {0} min", minutes);
	return nls.localize(
		"mete/strip/pausedHours",
		"paused {0} h {1} min",
		Math.floor(minutes / 60),
		minutes % 60,
	);
};

/** A fact of the meta line, with the whole reading in its tooltip. */
export type Fact = {
	readonly key: string;
	readonly text: string;
	readonly title?: string;
};

/** A number tile: a caption over a measured number. */
export type Tile = {
	readonly key: string;
	readonly caption: string;
	readonly value: string;
};

/** What the hero band shows of the shown run. */
export type Hero = {
	/** The run's status, once its entry has come. */
	readonly status?: {
		readonly status: Status;
		readonly word: string;
		readonly tone: Tone;
	};
	readonly facts: readonly Fact[];
	readonly tiles: readonly Tile[];
	/** A team run's approved tasks of all; none for a run without tasks. */
	readonly progress?: { readonly done: number; readonly total: number };
};

const teamFact = (facts: RunFacts, run: RunEntry): Fact => ({
	key: "team",
	text:
		run.templateId === null
			? nls.localize("mete/strip/singleAgent", "Single agent")
			: (facts.teamName ?? roleWords(run.templateId)),
});

// An ended run tells how long it took and, apart, how long of it was paused (ADR-139).
const timeFacts = (run: RunEntry, now: Date, paused: number): Fact[] => {
	const at = run.startedAt ?? run.createdAt;
	const started: Fact = {
		key: "started",
		text: nls.localize("mete/strip/started", "started {0}", shortWhen(at, now)),
		title: new Date(at).toLocaleString(),
	};
	if (!run.endedAt) return [started];
	const took = tookText(Date.parse(run.endedAt) - Date.parse(at));
	const pause = pausedText(paused);
	return [
		started,
		{ key: "took", text: took },
		...(pause ? [{ key: "paused", text: pause }] : []),
	];
};

const factsOf = (
	facts: RunFacts,
	run: RunEntry,
	now: Date,
	paused: number,
): Fact[] => [
	teamFact(facts, run),
	...timeFacts(run, now, paused),
	{
		key: "autonomy",
		text: nls.localize(
			"mete/strip/autonomy",
			"Autonomy {0}",
			optionLabel(run.autonomyLevel),
		),
	},
	{
		key: "limits",
		text: nls.localize(
			"mete/strip/limits",
			"up to {0} requests, {1} h",
			run.budget.cloudRequests,
			run.budget.maxHours,
		),
	},
];

// The tokens and calls the run's agents reported (ADR-090), and the checkpoints saved so far.
const tilesOf = (view: TeamView): Tile[] => {
	const used = view.agents.flatMap((a) => (a.usage ? [a.usage] : []));
	const sum = (n: (u: (typeof used)[number]) => number) =>
		used.reduce((total, u) => total + n(u), 0);
	return [
		{
			key: "calls",
			caption: nls.localize("mete/strip/calls", "Calls"),
			value: String(sum((u) => u.calls)),
		},
		{
			key: "tokens",
			caption: nls.localize("mete/strip/tokens", "Tokens"),
			value: tokenCount(sum((u) => u.tokens)),
		},
		{
			key: "checkpoints",
			caption: nls.localize("mete/strip/checkpoints", "Checkpoints"),
			value: String(view.checkpoints.length),
		},
	];
};

/** The hero band of the run's facts and its folded events; what the run's entry gives waits for it. */
export const heroOf = (
	facts: RunFacts,
	view: TeamView,
	now = new Date(),
): Hero => {
	const { run } = facts;
	const total = view.tasks.length;
	const done = view.tasks.filter((t) => t.status === "approved").length;
	return {
		...(run
			? {
					status: {
						status: run.status,
						word: statusWord(run.status),
						tone: statusTone(run.status),
					},
				}
			: {}),
		facts: run ? factsOf(facts, run, now, view.signals.paused) : [],
		tiles: tilesOf(view),
		...(total > 0 ? { progress: { done, total } } : {}),
	};
};
