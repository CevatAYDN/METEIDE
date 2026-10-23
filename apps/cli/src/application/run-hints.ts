import type { MeteEvent } from "@mete/contracts";
import type { App } from "../infrastructure/app.js";
import {
	providerStates,
	stateLine,
	trackExhausted,
} from "./provider-states.js";

// Only the error stream is needed; naming Io from commands.ts would make an import cycle.
type Err = { readonly err: (line: string) => void };

// The start checks of a run (ADR-044, Phase 5 onboarding): what the terminal says before a run
// starts when the folder lacks something a run relies on.

/** Said before a run starts when vcs-git is not active (docs/08: tasks then work in place). */
export const NO_GIT_LINE =
	"This folder is not a git repository (or git is not installed): tasks work in place, without worktrees or checkpoints.";

// A repository without a commit keeps vcs-git active; docs/08 logs that case when a task starts.
/** Prints the start lines for this folder. */
export const noteStart = (app: App, io: Err) => {
	if (app.inactive.some((m) => m.moduleId === "vcs-git")) io.err(NO_GIT_LINE);
};

/** The hint a pause prints under its event line. */
export const hintAt = (io: Err, e: MeteEvent) => {
	if (e.type !== "run.paused") return;
	if (e.payload.reason === "quota") io.err(QUOTA_HINT);
	if (e.payload.reason === "network") io.err(NETWORK_HINT);
};

// A network pause tries again by itself (docs/08, Single agent, Pauses).
const NETWORK_HINT =
	"The run waits for the network and tries again on its own; Ctrl+C stops it.";

// A quota pause waits for the reset; paid models can carry on meanwhile (ADR-042).
const QUOTA_HINT =
	"The run waits for the quota reset. To go on with paid models when the free ones run out, set models: both in .mete/gateway.yaml (spending is capped by dailySpendUsd, 1 US dollar a day by default).";

// The pause message of a quota or no_model pause (ADR-044): one line per provider that cannot carry
// the run on now, and why (a missing key, the privacy rules), from the same states the daemon's
// mete/quota answers (provider-states.ts).

/** One line per provider that cannot carry the run on now, and why. */
export const providerLines = async (
	app: App,
	until: (id: string) => string | undefined,
): Promise<string[]> =>
	(await providerStates(app, until)).flatMap((s) => {
		const line = stateLine(s);
		return line ? [line] : [];
	});

const PROVIDER_PAUSES = new Set(["quota", "no_model"]);

/**
 * Watches the run: after its quota or no_model pause, prints why each provider cannot help.
 * `printed` settles once those lines are out; a no_model pause ends the command, which awaits it.
 */
export const watchPauses = (
	app: App,
	io: Err,
	runId: () => string | undefined,
) => {
	const spent = trackExhausted(app.events);
	let printed = Promise.resolve();
	const paused = app.events.subscribe("run.paused", (e) => {
		if (!PROVIDER_PAUSES.has(e.payload.reason) || e.runId !== runId()) return;
		printed = providerLines(app, spent.until).then((lines) => {
			for (const line of lines) io.err(`  ${line}`);
		});
	});
	return {
		printed: () => printed,
		stop: () => {
			paused.dispose();
			spent.dispose();
		},
	};
};
