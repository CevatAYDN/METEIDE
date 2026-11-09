import {
	type CheckpointRestoreAdapter,
	type ConversationRunAdapter,
	type ConversationThreadAdapter,
	type ConversationThreadV2Adapter,
	type ConversationThreadV3Adapter,
	type EngineError,
	err,
	ok,
	type Result,
	type RunReplyAdapter,
	type RunSkillsAdapter,
	type TeamEngineAdapter,
} from "@mete/contracts";
import { clearTimer, type EngineState } from "./run-state.js";

export const retiring = () =>
	err({
		code: "failed" as const,
		message: "METE is restarting; retry after it reconnects",
	});

const drain = (s: EngineState) => {
	for (const live of s.live.values()) clearTimer(live);
	// Paused calls may still be finishing. Let them finish without aborting or replaying.
	return Promise.allSettled([...s.live.values()].map((live) => live.loop)).then(
		() => ok(null),
	);
};

const active = (s: EngineState) =>
	s.deps.store
		.list()
		.some((run) => run.status === "running" || run.status === "queued");

/** Counts admitted mutations and closes the gate synchronously with status. */
export const createQuiescence = (s: EngineState) => {
	let pending = 0;
	let draining: Promise<Result<null, EngineError>> | undefined;
	return {
		enter: async <T, E>(
			operation: () => Promise<Result<T, E>>,
		): Promise<Result<T, E | { code: "failed"; message: string }>> => {
			if (s.quiescing) return retiring();
			pending++;
			try {
				return await operation();
			} finally {
				pending--;
			}
		},
		prepare: (): Promise<Result<null, EngineError>> => {
			if (draining) return draining;
			if (s.quiescing) return Promise.resolve(retiring());
			if (pending > 0 || active(s))
				return Promise.resolve(
					err({
						code: "failed",
						message:
							"Work is active; configuration is saved and will apply later",
					}),
				);
			s.quiescing = true;
			draining = drain(s);
			return draining;
		},
	};
};

type Gate = ReturnType<typeof createQuiescence>;
type Adapters = {
	engine: TeamEngineAdapter;
	reply: RunReplyAdapter;
	conversation: ConversationRunAdapter;
	thread: ConversationThreadAdapter;
	threadContext: ConversationThreadV2Adapter;
	threadSkills: ConversationThreadV3Adapter;
	runSkills: RunSkillsAdapter;
	restore: CheckpointRestoreAdapter;
};

const gateContext = (
	gate: Gate,
	threadContext: ConversationThreadV2Adapter,
) => ({
	...threadContext,
	prepare: (input: Parameters<typeof threadContext.prepare>[0]) =>
		gate.enter(() => threadContext.prepare(input)),
	start: (input: Parameters<typeof threadContext.start>[0]) =>
		gate.enter(() => threadContext.start(input)),
	reply: (input: Parameters<typeof threadContext.reply>[0]) =>
		gate.enter(() => threadContext.reply(input)),
});

const gateSkills = (
	gate: Gate,
	threadSkills: ConversationThreadV3Adapter,
): ConversationThreadV3Adapter => ({
	...threadSkills,
	prepare: (input) => gate.enter(() => threadSkills.prepare(input)),
	start: (input) => gate.enter(() => threadSkills.start(input)),
	reply: (input) => gate.enter(() => threadSkills.reply(input)),
});

const gateConversations = (gate: Gate, adapters: Adapters) => {
	const { reply, conversation, thread } = adapters;
	return {
		reply: {
			reply: (input: Parameters<typeof reply.reply>[0]) =>
				gate.enter(() => reply.reply(input)),
		},
		conversation: {
			start: (input: Parameters<typeof conversation.start>[0]) =>
				gate.enter(() => conversation.start(input)),
			reply: (input: Parameters<typeof conversation.reply>[0]) =>
				gate.enter(() => conversation.reply(input)),
		},
		thread: {
			...thread,
			start: (input: Parameters<typeof thread.start>[0]) =>
				gate.enter(() => thread.start(input)),
			reply: (input: Parameters<typeof thread.reply>[0]) =>
				gate.enter(() => thread.reply(input)),
		},
		threadContext: gateContext(gate, adapters.threadContext),
		threadSkills: gateSkills(gate, adapters.threadSkills),
	};
};

/** Applies one admission gate to every adapter that can start work or mutate workspace files. */
export const gateAdapters = (
	gate: ReturnType<typeof createQuiescence>,
	adapters: Adapters,
) => {
	const { engine, restore, runSkills } = adapters;
	const remove = engine.remove;
	return {
		engine: {
			...engine,
			start: (req: Parameters<typeof engine.start>[0]) =>
				gate.enter(() => engine.start(req)),
			resume: (id: string) => gate.enter(() => engine.resume(id)),
			approve: (id: string, input: Parameters<typeof engine.approve>[1]) =>
				gate.enter(() => engine.approve(id, input)),
			...(remove
				? { remove: (id: string) => gate.enter(() => remove(id)) }
				: {}),
		},
		runSkills: {
			...runSkills,
			start: (input) => gate.enter(() => runSkills.start(input)),
		} satisfies RunSkillsAdapter,
		...gateConversations(gate, adapters),
		restore: {
			restore: (input: Parameters<typeof restore.restore>[0]) =>
				gate.enter(() => restore.restore(input)),
		},
		quiesce: { prepare: gate.prepare },
	};
};
