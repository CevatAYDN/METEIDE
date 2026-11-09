import {
	type ContextSnapshot,
	type ConversationCapability,
	type EngineError,
	err,
	ok,
	type Result,
	type RunPrefer,
} from "@mete/contracts";
import { initialTransition, transition } from "xstate";
import { contextMessages } from "../domain/context-prompt.js";
import { openingMessages, type Platform } from "../domain/prompt.js";
import type { RunSnapshot } from "../domain/run-machine.js";
import { runMachine } from "../domain/run-machine.js";
import type { RunSkillState } from "../domain/skill-state.js";
import type { TeamState } from "../domain/team.js";
import type { ThreadIntent, ThreadSaved } from "../domain/thread.js";
import type { RunMeta } from "../infrastructure/run-store.js";
import type { Opening } from "./continue.js";
import { fromConfig, policy } from "./engine-policy.js";
import type { ReplyStart } from "./reply.js";
import { drive } from "./run-driver.js";
import {
	apply,
	type EngineState,
	emit,
	hold,
	iso,
	type Live,
	platformOf,
} from "./run-state.js";
import { announce } from "./spawned.js";
import { readWorkspace } from "./workspace.js";

/** Server-owned opening for a fresh immutable run. */
export type Begin = {
	readonly id: string;
	readonly goal: string;
	readonly priority: 0 | 1 | 2;
	readonly team?: TeamState | undefined;
	readonly opening: Opening;
	readonly prefer?: RunPrefer | undefined;
	readonly workspace?: string | undefined;
	readonly conversation?: Pick<ReplyStart, "messages" | "tainted">;
	readonly extraCapabilities?: readonly ConversationCapability[] | undefined;
	readonly attachments?: readonly ContextSnapshot[] | undefined;
	/** Genuine S2 state for an @3 start; absent keeps legacy behavior. */
	readonly skills?: RunSkillState | undefined;
};
type Prepared = { readonly meta: RunMeta; readonly snapshot: RunSnapshot };

const initialSnapshot = (input: Begin, where: Platform) => {
	const {
		goal,
		priority,
		prefer,
		workspace,
		extraCapabilities,
		conversation,
		team,
	} = input;
	const brief = input.opening.brief;
	const messages =
		conversation?.messages ??
		(team ? [] : openingMessages(goal, where, brief, workspace));
	const [fresh] = initialTransition(runMachine, {
		goal,
		priority,
		prefer,
		brief,
		workspace,
		extraCapabilities,
		messages: [...messages, ...contextMessages(input.attachments ?? [])],
		tainted: conversation?.tainted || (input.attachments?.length ?? 0) > 0,
		attachments: input.attachments,
		skills: input.skills,
	});
	return team
		? transition(runMachine, fresh, { type: "TEAM", team })[0]
		: fresh;
};

const prepare = (
	s: EngineState,
	input: Begin,
): Result<Prepared, EngineError> => {
	const p = policy(s, input.team);
	if (!p.ok) return p;
	const where = platformOf(s);
	if (!where.ok) return err(fromConfig(where.error));
	const snapshot = initialSnapshot(input, where.value);
	const meta = {
		id: input.id,
		workspaceId: s.deps.workspaceId,
		autonomyLevel: p.value.autonomy,
		budget: p.value.budget,
		createdAt: iso(s.deps.now()),
	};
	return ok({ meta, snapshot });
};

const launch = (
	s: EngineState,
	prepared: Prepared,
	input: Begin,
	held?: Live,
) => {
	const { meta, snapshot } = prepared;
	const l = held ?? hold(s, meta, snapshot);
	const templateId = input.team?.template.metadata.id ?? null;
	if (!held)
		emit(s, l, {
			type: "run.created",
			payload: { templateId, goal: input.goal },
		});
	if (input.opening.accepted)
		emit(s, l, {
			type: "handoff.accepted",
			payload: { handoffId: input.opening.accepted, byRunId: meta.id },
		});
	apply(s, l, { type: "START", at: s.deps.now() });
	if (input.team)
		announce(
			s,
			l,
			input.team,
			input.team.template.tasks.map((t) => t.id),
		);
	drive(s, l);
};

/** Legacy admission retains its synchronous saved-history reply behavior. */
export const begin = (
	s: EngineState,
	input: Begin,
): Result<{ runId: string }, EngineError> => {
	const prepared = prepare(s, input);
	if (!prepared.ok) return prepared;
	s.deps.store.save(prepared.value.meta, prepared.value.snapshot);
	launch(s, prepared.value, input);
	return ok({ runId: input.id });
};

const saveInitial = (
	s: EngineState,
	prepared: Prepared,
	intent: ThreadIntent,
) => {
	try {
		return s.deps.store.saveInitial(prepared.meta, prepared.snapshot, intent);
	} catch {
		return err<EngineError>({
			code: "failed",
			message: "conversation intent could not be saved",
		});
	}
};

const withWorkspace = async (s: EngineState, live: Live, input: Begin) => {
	const workspace = await readWorkspace(s.deps, input.id, live.all.signal);
	const where = platformOf(s);
	if (!where.ok) return err(fromConfig(where.error));
	const context = {
		...live.snapshot.context,
		workspace,
		messages: [
			...openingMessages(
				input.goal,
				where.value,
				input.opening.brief,
				workspace,
			),
			...contextMessages(live.snapshot.context.attachments ?? []),
		],
	};
	const snapshot = runMachine.resolveState({
		value: live.snapshot.value,
		context,
	});
	return ok({ meta: live.meta, snapshot });
};

const admitted = (s: EngineState, live: Live) =>
	s.live.get(live.meta.id) === live &&
	live.snapshot.value === "queued" &&
	s.deps.store.list(live.meta.id)[0]?.status === "queued";

const preparationFailed = (s: EngineState, live: Live) => {
	const error: EngineError = {
		code: "failed",
		message: "Conversation preparation did not finish.",
	};
	if (admitted(s, live)) {
		apply(s, live, { type: "START", at: s.deps.now() });
		apply(
			s,
			live,
			live.all.signal.aborted
				? { type: "PAUSE", at: s.deps.now(), reason: "user" }
				: {
						type: "FAIL",
						at: s.deps.now(),
						code: "failed",
						message: error.message,
					},
		);
	}
	return err(error);
};

const completeThread = async (s: EngineState, live: Live, input: Begin) => {
	try {
		if (!admitted(s, live) || live.all.signal.aborted)
			return preparationFailed(s, live);
		const ready = input.conversation
			? ok({ meta: live.meta, snapshot: live.snapshot })
			: await withWorkspace(s, live, input);
		// A cancelled or removed admission can never be restored by a late context read.
		if (!admitted(s, live) || live.all.signal.aborted || !ready.ok)
			return preparationFailed(s, live);
		s.deps.store.save(live.meta, ready.value.snapshot);
		live.snapshot = ready.value.snapshot;
		launch(s, ready.value, input, live);
		return ok(undefined);
	} catch {
		return preparationFailed(s, live);
	}
};

/** ADR-182 commits before even the context-building file tools, and never launches a replay. */
export const beginThread = async (
	s: EngineState,
	input: Begin,
	intent: ThreadIntent,
): Promise<Result<ThreadSaved, EngineError>> => {
	const prepared = prepare(s, input);
	if (!prepared.ok) return prepared;
	const saved = saveInitial(s, prepared.value, intent);
	if (!saved.ok || !saved.value.fresh) return saved;
	const live = hold(s, prepared.value.meta, prepared.value.snapshot);
	emit(s, live, {
		type: "run.created",
		payload: { templateId: null, goal: input.goal },
	});
	const pending = Promise.resolve().then(() => completeThread(s, live, input));
	live.loop = pending.then(
		() => undefined,
		() => undefined,
	);
	const ready = await pending;
	return ready.ok ? saved : ready;
};
