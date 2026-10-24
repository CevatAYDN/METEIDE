import { nls } from "@theia/core/lib/common/nls";
import type { DaemonFailure, StatusRuns } from "../domain/status-service.js";

// The words of "METE: Status"; every string goes through Theia's localization (docs/05).

// The longest run list one message shows; the rest are counted, and the Home panel lists them all.
const SHOWN_RUNS = 5;

const moreText = (hidden: number) =>
	hidden > 0
		? `; ${nls.localize("mete/status/more", "and {0} more; the Home panel lists them all", hidden)}`
		: "";

// Theia renders a message as Markdown, so a message escapes text from outside (daemon output, a
// goal): without it a Windows path loses its backslashes. A React panel shows text as it is.
/** Escapes Markdown in text that came from outside, for a Theia message. */
export const plain = (text: string) =>
	text.replace(/[\\`*_{}[\]()<>#+\-.!|~]/g, "\\$&");

const asIs = (text: string) => text;

/** Says that METE works on one open folder. */
export const noFolderText = () =>
	nls.localize(
		"mete/status/noFolder",
		"Open a folder first: METE works on one folder at a time.",
	);

// One literal nls.localize call per reason, so Theia's nls-extract can read each text.
const FAILURE: Record<DaemonFailure["code"], (detail: string) => string> = {
	cli: (d) =>
		nls.localize("mete/status/cli", "The mete command failed: {0}", d),
	not_ready: (d) =>
		nls.localize("mete/status/notReady", "METE is not ready yet: {0}", d),
	choose_template: (d) =>
		nls.localize(
			"mete/status/chooseTemplate",
			"Choose a team for this goal: {0}",
			d,
		),
	blocked: (d) =>
		nls.localize(
			"mete/status/blocked",
			"The METE daemon keeps stopping, so METE does not start it again for now: {0}",
			d,
		),
	refused: (d) =>
		nls.localize(
			"mete/status/refused",
			"The METE daemon refused the request: {0}",
			d,
		),
	protocol: (d) =>
		nls.localize(
			"mete/status/protocol",
			"The METE daemon sent an answer METE does not understand: {0}",
			d,
		),
	stopped: (d) =>
		nls.localize("mete/status/stopped", "The METE daemon stopped: {0}", d),
};

// A run's status in words, shared by the run strip, the Runs list and this message (ADR-094).
const STATUS_WORD: Record<StatusRuns[number]["status"], () => string> = {
	queued: () => nls.localize("mete/strip/queued", "Queued"),
	running: () => nls.localize("mete/strip/running", "Running"),
	paused: () => nls.localize("mete/strip/paused", "Paused"),
	completed: () => nls.localize("mete/strip/completed", "Done"),
	failed: () => nls.localize("mete/strip/failed", "Failed"),
	cancelled: () => nls.localize("mete/strip/cancelled", "Cancelled"),
};

/** A run's status as a word. */
export const statusWord = (status: StatusRuns[number]["status"]) =>
	STATUS_WORD[status]();

/** Says why the daemon gave no runs, with what it reported; `prepare` readies outside text. */
export const failureText = ({ code, detail }: DaemonFailure, prepare = asIs) =>
	FAILURE[code](prepare(detail));

/** Counts the runs of the folder and names the newest ones by status and goal. */
export const runsText = (runs: StatusRuns, prepare = asIs) =>
	runs.length === 0
		? nls.localize("mete/status/none", "No runs in this folder yet.")
		: nls.localize(
				"mete/status/runs",
				"{0} run(s) in this folder: {1}",
				runs.length,
				runs
					.slice(0, SHOWN_RUNS)
					.map((r) => `${statusWord(r.status)} "${prepare(r.goal)}"`)
					.join("; ") + moreText(runs.length - SHOWN_RUNS),
			);
