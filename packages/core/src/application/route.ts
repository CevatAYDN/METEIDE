import { type EngineError, err, ok, type Result } from "@mete/contracts";
import { routeOf, routeRequest } from "../domain/router.js";
import type { Seat } from "../domain/tools.js";
import { listTemplates } from "../infrastructure/template-store.js";
import type { EngineState } from "./run-state.js";
import { callModel } from "./steps.js";

// The router of docs/08 for a run that named no template: one call to the fast tier (docs/09)
// before the run exists. Every way it falls back to a single agent is logged with the reason.

const ROUTER: Seat = { tier: "fast", needs: [], capabilities: [] };

// shortcut: the router call has no run yet, so stop() cannot abort it (the gateway's own
// retries bound it), and its model_calls row names a run id that a choose_template answer
// never creates; route through a pre-created run when the desktop shows routing.

// The templates the router may pick; one that does not load is logged, and a folder that
// cannot be read gives the reason instead.
const offered = async (s: EngineState) => {
	if (!s.deps.templates) return [];
	try {
		const found = await listTemplates(s.deps.templates);
		for (const b of found.broken)
			s.deps.logger.warn(
				{ templateId: b.id, error: b.error },
				"template not offered to the router",
			);
		return found.templates;
	} catch (e) {
		return `templates cannot be listed: ${e instanceof Error ? e.message : String(e)}`;
	}
};

/** The template to run, undefined for a single agent, or choose_template when the router is unsure. */
export const routeFor = async (
	s: EngineState,
	run: { goal: string; runId: string; priority: 0 | 1 | 2 },
): Promise<Result<string | undefined, EngineError>> => {
	const warn = (why: string) => {
		s.deps.logger.warn(
			{ runId: run.runId, reason: why },
			"router fell back to a single agent",
		);
		return ok(undefined);
	};
	const templates = await offered(s);
	if (typeof templates === "string") return warn(templates);
	if (templates.length === 0) return ok(undefined);
	const messages = routeRequest(run.goal, templates);
	const call = {
		runId: run.runId,
		priority: run.priority,
		messages,
		seat: ROUTER,
	};
	const out = await callModel(
		s.deps,
		call,
		() => {},
		new AbortController().signal,
	);
	if (out.kind !== "replied")
		return warn(out.kind === "error" ? out.error.code : "no llm.chat@1");
	const route = routeOf(out.message.content, templates);
	if (route.kind === "fallback") return warn(route.why);
	if (route.kind === "choose")
		return err({
			code: "choose_template",
			message:
				"The router is not sure which team fits; pick a template or run a single agent.",
			suggestions: route.suggestions,
		});
	return ok(route.kind === "team" ? route.templateId : undefined);
};
