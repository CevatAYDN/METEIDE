import { nls } from "@theia/core/lib/common/nls";
import type { DaemonFailure, StatusRuns } from "../domain/status-service.js";

// The words of "METE: Status"; every string goes through Theia's localization (docs/05).

// shortcut: the longest run list one message shows; a panel lists them all (Phase 5, team panel).
const SHOWN_RUNS = 5;

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

/** Says why the daemon gave no runs, with what it reported; `prepare` readies outside text. */
export const failureText = (
	{ code, detail: raw }: DaemonFailure,
	prepare = asIs,
) => {
	const detail = prepare(raw);
	if (code === "not_ready")
		return nls.localize(
			"mete/status/notReady",
			"METE is not ready yet: {0}",
			detail,
		);
	if (code === "choose_template")
		return nls.localize(
			"mete/status/chooseTemplate",
			"Choose a team for this goal: {0}",
			detail,
		);
	if (code === "blocked")
		return nls.localize(
			"mete/status/blocked",
			"The METE daemon keeps stopping, so METE does not start it again for now: {0}",
			detail,
		);
	if (code === "refused")
		return nls.localize(
			"mete/status/refused",
			"The METE daemon refused the request: {0}",
			detail,
		);
	if (code === "protocol")
		return nls.localize(
			"mete/status/protocol",
			"The METE daemon sent an answer METE does not understand: {0}",
			detail,
		);
	return nls.localize(
		"mete/status/stopped",
		"The METE daemon stopped: {0}",
		detail,
	);
};

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
					.map((r) => `${r.status} "${prepare(r.goal)}"`)
					.join("; "),
			);
