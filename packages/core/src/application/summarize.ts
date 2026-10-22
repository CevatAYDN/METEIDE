import { compacted, type Split, summaryRequest } from "../domain/compact.js";
import { afterModelError } from "../domain/run-events.js";
import type { Seat } from "../domain/tools.js";
import { apply, type EngineState, emit, type Live } from "./run-state.js";
import { callModel } from "./steps.js";

// The summary step of docs/08 (Agent context assembly): the fast tier (docs/09, Model tiers)
// turns the older turns into one summary. It is a model call like any other, so a quota, a
// missing model or a cancel pauses or stops the run the same way.

const SUMMARIZER: Seat = { tier: "fast", needs: [], capabilities: [] };

const EMPTY = "(No summary could be made of the earlier turns.)";

/** Replaces the middle turns of the conversation by their summary; `owned` says the loop still runs. */
export const summarizeTurn = async (
	s: EngineState,
	l: Live,
	split: Split,
	owned: () => boolean,
) => {
	const model = new AbortController();
	l.model = model;
	const signal = AbortSignal.any([l.all.signal, model.signal]);
	const { priority } = l.snapshot.context;
	const messages = summaryRequest(split.middle);
	const run = { runId: l.meta.id, priority, messages, seat: SUMMARIZER };
	const out = await callModel(s.deps, run, () => {}, signal).finally(() => {
		l.model = undefined;
	});
	if (!owned()) return; // paused or cancelled meanwhile: the summary is dropped
	const at = s.deps.now();
	if (out.kind === "missing")
		return apply(s, l, { type: "PAUSE", at, reason: "no_model" });
	if (out.kind === "error") return apply(s, l, afterModelError(out.error, at));
	let summary = out.message.content.trim();
	if (!summary) {
		// The turns still go, or the next step would ask again forever; the log says so.
		s.deps.logger.warn(
			{ runId: l.meta.id },
			"empty summary; older turns dropped",
		);
		summary = EMPTY;
	}
	if (!apply(s, l, { type: "SUMMARIZED", messages: compacted(split, summary) }))
		return;
	const payload = { messages: split.middle.length, chars: summary.length };
	emit(s, l, { type: "run.summarized", payload });
};
