import {
	type ApprovalInput,
	type ConversationCapability,
	type EngineError,
	err,
	type ModelRef,
	ok,
	type Result,
	type RunSkillPolicy,
	type RunStart,
	RunStartSchema,
	type TeamEngineV3Adapter,
} from "@mete/contracts";
import { z } from "zod";
import type { RunSkillState } from "../domain/skill-state.js";
import { type TeamState, teamOf } from "../domain/team.js";
import {
	loadTemplate,
	type TemplateError,
} from "../infrastructure/template-store.js";
import { recordDecision } from "./approvals.js";
import { begin } from "./begin.js";
import { createCheckpointQueue } from "./checkpoint-queue.js";
import { offerBrief, takeHandoff } from "./continue.js";
import { createConversation } from "./conversation.js";
import { policy } from "./engine-policy.js";
import { nextPrefer, validateStartPrefer } from "./pinned.js";
import { createQuiescence, gateAdapters, retiring } from "./quiesce.js";
import { recover } from "./recovery.js";
import { removeRun } from "./remove.js";
import { createReply, type ReplyStart } from "./reply.js";
import { createCheckpointRestore } from "./restore.js";
import { pruneOldCheckpoints } from "./retention.js";
import { routeFor } from "./route.js";
import { drive } from "./run-driver.js";
import { createRunSkills } from "./run-skills.js";
import {
	apply,
	clearTimer,
	type EngineDeps,
	type EngineState,
	hold,
	type Live,
	loaded,
	peek,
} from "./run-state.js";
import { admitRunSkills } from "./skill-admission.js";
import { guardResume } from "./skill-guard.js";
import { liveSkillHost } from "./skill-host.js";
import { createSkillLoadAuthority } from "./skill-load-authority.js";
import { loadSkill, type SkillLoadRequest } from "./skill-loader.js";
import { readSkills } from "./skill-reads.js";
import { createTaskControl } from "./task-control.js";
import {
	forgetPolicyRequests,
	recoverTaskControls,
} from "./task-control-recovery.js";
import { createThreadContext } from "./thread-context.js";
import { createThreadMutations } from "./thread-mutations.js";
import { createThreadReads } from "./thread-reads.js";
import { readTranscript } from "./transcript.js";
import { cancelVerification, createVerification } from "./verification.js";
import { readWorkspace } from "./workspace.js";

// team.engine@3 (docs/06 engine types, docs/07 Run state machine, docs/08 Single agent and teams).

type Out<T> = Promise<Result<T, EngineError>>;

const invalid = (l: Live, call: string): Result<never, EngineError> =>
	err({
		code: "invalid_state",
		message: `cannot ${call} a ${l.snapshot.value} run`,
		status: l.snapshot.value,
	});

const find = (s: EngineState, runId: string): Result<Live, EngineError> => {
	const held = s.live.get(runId);
	if (held) return ok(held);
	if (!z.uuid().safeParse(runId).success)
		return err({ code: "not_found", message: `no run ${runId}` });
	const row = loaded(s, runId);
	if (!row.ok) return row;
	return row.value
		? ok(hold(s, row.value.meta, row.value.snapshot))
		: err({ code: "not_found", message: `no run ${runId}` });
};

const fromTemplate = (e: TemplateError): EngineError =>
	e.code === "invalid_template"
		? { code: "bad_input", message: e.issues.join("; ") }
		: {
				code: e.code === "not_found" ? "not_found" : "bad_input",
				message: e.message,
			};

const start = async (
	s: EngineState,
	req: RunStart,
	extraCapabilities: readonly ConversationCapability[] = [],
	skillPolicy?: RunSkillPolicy,
): Out<{ runId: string }> => {
	const r = RunStartSchema.safeParse(req);
	if (!r.success)
		return err({ code: "bad_input", message: z.prettifyError(r.error) });
	const id = s.deps.newId();
	// No template named: the router decides; null asks for a single agent (docs/08, Router).
	const { templateId, goal: asked, priority: p } = r.data;
	const routed =
		templateId === undefined && asked && !r.data.continue
			? await routeFor(s, { goal: asked, runId: id, priority: p })
			: ok(templateId);
	if (!routed.ok) return routed;
	const team = await teamFor(s, routed.value);
	if (!team.ok) return team;
	const validPrefer = validateStartPrefer(team.value, r.data.prefer);
	if (!validPrefer.ok) return validPrefer;
	const skills = await skillsFor(s, id, skillPolicy, team.value);
	if (!skills.ok) return skills;
	// The template is checked first, so a bad one never uses up a handoff.
	const opening = r.data.continue ? takeHandoff(s, id) : ok(offerBrief(s));
	if (!opening.ok) return opening;
	// The schema asks for a goal unless the run continues, and a handoff always names one.
	const goal = r.data.goal ?? opening.value.goal ?? "";
	const { priority, prefer } = r.data;
	return begin(s, {
		id,
		goal,
		priority,
		team: team.value,
		opening: opening.value,
		prefer,
		workspace: await readWorkspace(s.deps, id),
		extraCapabilities,
		skills: skills.value,
	});
};

/** Legacy starts carry no S2 state; run.skills@1 starts are admitted before any handoff. */
const skillsFor = async (
	s: EngineState,
	runId: string,
	policy: RunSkillPolicy | undefined,
	team: TeamState | undefined,
): Promise<Result<RunSkillState | undefined, EngineError>> =>
	policy ? admitRunSkills(s, runId, policy, team) : ok(undefined);

const teamFor = async (
	s: EngineState,
	templateId: string | null | undefined,
): Promise<Result<TeamState | undefined, EngineError>> => {
	if (!templateId) return ok(undefined);
	if (!s.deps.templates)
		return err({
			code: "not_supported",
			message: "no template folders are set",
		});
	const t = await loadTemplate(s.deps.templates, templateId);
	return t.ok ? ok(teamOf(t.value, s.deps.newId)) : err(fromTemplate(t.error));
};

const pause = async (s: EngineState, runId: string): Out<void> => {
	const l = find(s, runId);
	if (!l.ok) return l;
	if (!apply(s, l.value, { type: "PAUSE", at: s.deps.now(), reason: "user" }))
		return invalid(l.value, "pause");
	l.value.model?.abort(); // a tool call in flight finishes (docs/08)
	return ok(undefined);
};

// The budget is read again, so a raised budget clears a budget pause (docs/08).
// An S2 run validates its skills first; manual and timed resume share this check (ADR-190).
const resume = async (s: EngineState, runId: string): Out<void> => {
	if (s.quiescing) return retiring();
	const l = find(s, runId);
	if (!l.ok) return l;
	if (l.value.snapshot.value !== "paused") return invalid(l.value, "resume");
	const p = policy(s, l.value.snapshot.context.team);
	if (!p.ok) return p;
	const guarded = await guardResume(s, l.value);
	if (!guarded.ok) return guarded;
	l.value.meta = { ...l.value.meta, budget: p.value.budget };
	clearTimer(l.value);
	if (!apply(s, l.value, { type: "RESUME", at: s.deps.now() }))
		return invalid(l.value, "resume");
	drive(s, l.value);
	return ok(undefined);
};

// The human's decision clears the approval pause, so the run goes on at once (docs/07).
const approveRun = async (
	s: EngineState,
	runId: string,
	input: ApprovalInput,
): Out<void> => {
	const l = find(s, runId);
	if (!l.ok) return l;
	const recorded = recordDecision(s, l.value, input);
	if (!recorded.ok) return recorded;
	return resume(s, runId);
};

const updateModel = async (
	s: EngineState,
	runId: string,
	model: ModelRef | null,
	roleId?: string,
): Out<void> => {
	const l = find(s, runId);
	if (!l.ok) return l;
	if (
		l.value.snapshot.value !== "running" &&
		l.value.snapshot.value !== "paused" &&
		l.value.snapshot.value !== "queued"
	)
		return invalid(l.value, "model");
	const next = nextPrefer(l.value.snapshot.context, model, roleId);
	if (!next.ok) return next;
	apply(s, l.value, { type: "PREFER", prefer: next.value });
	l.value.pin = undefined;
	return ok(undefined);
};

const cancel = async (s: EngineState, runId: string): Out<void> => {
	const l = find(s, runId);
	if (!l.ok) return l;
	cancelVerification(s, l.value);
	if (!apply(s, l.value, { type: "CANCEL", at: s.deps.now() }))
		return invalid(l.value, "cancel");
	l.value.all.abort();
	forgetPolicyRequests(s, runId);
	clearTimer(l.value);
	return ok(undefined);
};

const status: (
	s: EngineState,
	runId?: string,
) => ReturnType<TeamEngineV3Adapter["status"]> = (s, runId) => {
	const runs = s.deps.store.list(runId);
	if (runId !== undefined && runs.length === 0)
		return err({ code: "not_found", message: `no run ${runId}` });
	// One run carries its model choice; the list never reads every snapshot (ADR-125).
	const one = runId === undefined ? undefined : peek(s, runId);
	const prefer = one?.ok ? one.value.context.prefer : undefined;
	return ok(prefer ? runs.map((r) => ({ ...r, prefer })) : runs);
};

// Nothing awaits the timer, so a failed or throwing resume is logged rather than lost.
const pauseEnded = (s: EngineState, runId: string) => {
	const log = (fields: Record<string, unknown>) =>
		s.deps.logger.error(
			{ runId, ...fields },
			"run not resumed when its pause ended",
		);
	resume(s, runId).then(
		(r) => {
			if (!r.ok) log({ code: r.error.code });
		},
		(e: unknown) => log({ err: e }),
	);
};

/** Pauses every running run, aborts what is in flight and waits for the loops to stop. */
const stop = async (s: EngineState) => {
	s.quiescing = true;
	for (const l of s.live.values()) {
		apply(s, l, { type: "PAUSE", at: s.deps.now(), reason: "user" });
		l.token = {};
		l.model?.abort();
		l.all.abort();
		clearTimer(l);
	}
	await Promise.allSettled([...s.live.values()].map((l) => l.loop));
};

const engineAdapter = (s: EngineState): TeamEngineV3Adapter => ({
	start: (req) => start(s, req),
	pause: (runId) => pause(s, runId),
	resume: (runId) => resume(s, runId),
	cancel: (runId) => cancel(s, runId),
	approve: (runId, input) => approveRun(s, runId, input),
	status: (runId) => status(s, runId),
	model: (runId, model, roleId) => updateModel(s, runId, model, roleId),
	transcript: (runId) => readTranscript(s, runId),
	remove: (runId) => removeRun(s, runId),
});

const adaptersOf = (s: EngineState) => {
	const { context, skills, ...threadMutations } = createThreadMutations(s);
	const threadReads = createThreadReads(s);
	const replyStart = ({ messages, tainted, ...input }: ReplyStart) =>
		begin(s, {
			...input,
			id: s.deps.newId(),
			opening: {},
			conversation: { messages, tainted },
		});
	return {
		engine: engineAdapter(s),
		runSkills: createRunSkills(
			({ skills, ...req }) => start(s, req, [], skills),
			(input) => readSkills(s, input),
		),
		reply: createReply(s, replyStart),
		conversation: createConversation(s, {
			start: (req, extras) => start(s, req, extras),
			reply: replyStart,
		}),
		thread: { ...threadMutations, ...threadReads },
		threadContext: createThreadContext(s, context, threadReads),
		// @3 shares @2 reads and context; only start/reply carry the S2 policy.
		threadSkills: {
			...createThreadContext(s, context, threadReads),
			...skills,
		},
		restore: createCheckpointRestore(s.deps, async (runId) => {
			await s.live.get(runId)?.loop;
		}),
	};
};

/**
 * Creates team.engine@3; the module calls `recover` when it activates in the process that drives runs
 * (it also prunes old checkpoints), and `stop` when it deactivates.
 */
export const createEngine = (deps: EngineDeps) => {
	const s: EngineState = {
		deps: { ...deps, checkpointQueue: createCheckpointQueue() },
		live: new Map(),
		onPauseEnded: (runId) => pauseEnded(s, runId),
		skillLoads: createSkillLoadAuthority(),
	};
	const gate = createQuiescence(s);
	s.gate = gate;
	const tasks = createTaskControl(s, {
		find: (id) => find(s, id),
		resume: (id) => resume(s, id),
	});
	return {
		/** Composition hands this to security; it is the only native load authority. */
		skillLoadAdmission: s.skillLoads.admission,
		/** Native load for a live run's own context; never a model tool by itself (E5+). */
		loadSkill: (runId: string, req: SkillLoadRequest) => {
			const l = s.live.get(runId);
			return l
				? loadSkill(liveSkillHost(s, l), req)
				: Promise.resolve(err({ code: "stale" } as const));
		},
		tasks: {
			pending: tasks.pending,
			answer: (input: Parameters<typeof tasks.answer>[0]) =>
				gate.enter(() => tasks.answer(input)),
		},
		verification: createVerification(s),
		...gateAdapters(gate, adaptersOf(s)),
		// Only the process that drives runs recovers them and prunes old checkpoints, so a command
		// that only reads (mete status, mete events) never removes refs a live run may still use.
		recover: () => {
			recover(s, find);
			recoverTaskControls(s);
			void pruneOldCheckpoints(s.deps);
		},
		stop: () => stop(s),
	};
};

export type { EngineDeps };
