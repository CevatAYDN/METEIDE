import {
	type EngineError,
	err,
	type MeteEvent,
	ok,
	type PolicyAsk,
	type PolicyGrantAdapter,
	type Result,
	type TeamEngineAdapter,
} from "@mete/contracts";
import { allowCommandForGood } from "@mete/security";
import { ASK_WAIT_MS } from "../defaults.js";
import type { App } from "../infrastructure/app.js";
import { runHistory } from "../infrastructure/history.js";

// The human's answer to a policy ask (ARCHITECTURE.md, CLI; SECURITY.md, Answering an ask; ADR-121):
// mete allow, the terminal's question at a policy-ask pause, and mete/run.allow.

/** Once, for the rest of the run, or a command for good. */
export type AllowScope = "once" | "run" | "always";

/** A policy.asked event of the run's history or the bus. */
export type Asked = Extract<MeteEvent, { type: "policy.asked" }>;

const askOf = ({ rule: _, ...ask }: Asked["payload"]): PolicyAsk => ask;

/** The ask an approval pause waits on: the run's newest policy.asked since it last started or resumed. */
export const pendingAsk = (events: readonly MeteEvent[]) => {
	let asked: Asked | undefined;
	for (const e of events) {
		if (e.type === "run.started" || e.type === "run.resumed") asked = undefined;
		else if (e.type === "policy.asked") asked = e;
	}
	return asked;
};

/** Whether Always may be offered: a command whose text the event did not mask. */
export const canAlways = (ask: PolicyAsk) =>
	ask.action === "shell.exec" &&
	ask.command !== undefined &&
	!ask.command.includes("[SECRET:");

/**
 * The pause's ask from the history, or the policy.asked masking publishes after the pause, waited
 * for up to `ms`; it subscribes before it reads, so an event between the two is not missed.
 */
export const waitForAsk = (app: App, runId: string, ms = ASK_WAIT_MS) =>
	new Promise<Asked | undefined>((resolve) => {
		const done = (asked: Asked | undefined) => {
			sub.dispose();
			clearTimeout(timer);
			resolve(asked);
		};
		const sub = app.events.subscribe("policy.asked", (e) => {
			if (e.runId === runId) done(e);
		});
		const timer = setTimeout(() => done(undefined), ms);
		const seen = pendingAsk(runHistory(app.registry, runId)?.events ?? []);
		if (seen) done(seen);
	});

const WITH_ALWAYS =
	"Allow once (o), for this run (r), always (a) or keep it paused (Enter)? ";
const WITHOUT_ALWAYS =
	"Allow once (o), for this run (r) or keep it paused (Enter)? ";

/** The terminal's answer; anything but o, r or an offered a keeps the run paused. */
export const askScope = async (
	read: (prompt: string) => Promise<string | undefined>,
	ask: PolicyAsk,
): Promise<AllowScope | undefined> => {
	const always = canAlways(ask);
	const answer = (await read(always ? WITH_ALWAYS : WITHOUT_ALWAYS))
		?.trim()
		.toLowerCase();
	if (answer === "o") return "once";
	if (answer === "r") return "run";
	return answer === "a" && always ? "always" : undefined;
};

const notFound = (message: string): EngineError => ({
	code: "not_found",
	message,
});

const askFor = (
	app: App,
	engine: TeamEngineAdapter,
	runId: string,
): Result<PolicyAsk, EngineError> => {
	const view = engine.status(runId);
	if (!view.ok) return view;
	const run = view.value[0];
	if (run?.status !== "paused" || run.pauseReason !== "approval")
		return err(notFound(`run ${runId} is not paused for approval`));
	const asked = pendingAsk(runHistory(app.registry, runId)?.events ?? []);
	return asked
		? ok(askOf(asked.payload))
		: err(notFound(`run ${runId} has no policy ask to answer`));
};

const writeAlways = async (
	app: App,
	ask: PolicyAsk,
): Promise<Result<string, EngineError>> => {
	if (!canAlways(ask) || ask.command === undefined)
		return err({
			code: "bad_input",
			message:
				"Always allow takes a command whose text was not masked; allow it once or for the run",
		});
	const r = await allowCommandForGood(app.workspaceDir, ask.command);
	return r.ok ? r : err({ code: "bad_input", message: r.error });
};

/** Grants the run's pending ask, after writing an Always to the policy file, then resumes the run. */
export const allowAndResume = async (
	app: App,
	engine: TeamEngineAdapter,
	runId: string,
	scope: AllowScope,
): Promise<Result<void, EngineError>> => {
	const ask = askFor(app, engine, runId);
	if (!ask.ok) return ask;
	const grants = app.registry.resolve<PolicyGrantAdapter>("policy.grant@1");
	if (!grants.ok)
		return err({
			code: "not_supported",
			message: "policy.grant@1 is not active",
		});
	if (scope === "always") {
		const written = await writeAlways(app, ask.value);
		if (!written.ok) return written;
	}
	const granted = scope === "run" ? "run" : "once";
	grants.value[0].impl.grant({ runId, scope: granted, ask: ask.value });
	return engine.resume(runId);
};
