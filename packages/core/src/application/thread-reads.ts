import {
	type ConversationThread,
	type ConversationThreadAdapter,
	type EngineError,
	err,
	ok,
	type Result,
	type RunView,
	type SecretsMaskAdapter,
	type ThreadCursor,
	ThreadListInputSchema,
	type ThreadListResult,
	ThreadReadInputSchema,
} from "@mete/contracts";
import { z } from "zod";
import type { EngineState } from "./run-state.js";

type Group = {
	readonly id: string;
	readonly turns: RunView[];
	readonly createdAt: string;
	readonly messages: ReadonlyMap<string, string | null>;
};
const Masked = z.strictObject({
	text: z.string(),
	masked: z.number().int().nonnegative(),
});
const maskText = async (masker: SecretsMaskAdapter, text: string) =>
	Masked.parse(await masker.mask(text)).text;
const maskView = async (
	masker: SecretsMaskAdapter,
	view: RunView,
): Promise<RunView> => ({ ...view, goal: await maskText(masker, view.goal) });

const groups = (s: EngineState, search = false): Group[] => {
	const links = new Map(
		s.deps.store.threads.links().map((link) => [link.runId, link]),
	);
	const rows = new Map<string, RunView[]>();
	for (const run of s.deps.store
		.list()
		.filter((run) => run.templateId === null)) {
		const id = links.get(run.id)?.conversationId ?? run.id;
		const turns = rows.get(id) ?? [];
		turns.push(run);
		rows.set(id, turns);
	}
	return [...rows].map(([id, turns]) => {
		turns.sort(
			(a, b) =>
				(links.get(a.id)?.position ?? 0) - (links.get(b.id)?.position ?? 0),
		);
		return {
			id,
			turns,
			createdAt:
				s.deps.store.threads.createdAt(id) ?? turns[0]?.createdAt ?? "",
			messages: search
				? new Map(
						s.deps.store.threads
							.members(id)
							.map((turn) => [turn.runId, turn.message]),
					)
				: new Map<string, string | null>(),
		};
	});
};

const summary = (group: Group): ConversationThread => {
	const head = group.turns.at(-1);
	const first = group.turns[0];
	if (!head || !first) throw new Error("empty conversation group");
	return {
		id: group.id,
		title: first.goal,
		head,
		createdAt: group.createdAt,
		updatedAt: head.createdAt,
		turnCount: group.turns.length,
	};
};
const order = (a: ThreadCursor, b: ThreadCursor) =>
	a.updatedAt === b.updatedAt
		? a.id < b.id
			? 1
			: a.id > b.id
				? -1
				: 0
		: a.updatedAt < b.updatedAt
			? 1
			: -1;

const retained = (s: EngineState, group: Group) =>
	group.turns.every((run) => {
		const current = s.deps.store.list(run.id)[0];
		const member = s.deps.store.threads.membership(run.id);
		return (
			current?.workspaceId === run.workspaceId &&
			current?.templateId === null &&
			(member?.conversationId ?? run.id) === group.id
		);
	});

const matchesMessage = async (
	group: Group,
	query: string,
	masker: SecretsMaskAdapter,
) => {
	// Only captured members may contribute text; the whole group is revalidated before return.
	for (const turn of group.turns) {
		const message = group.messages.get(turn.id);
		if (
			typeof message === "string" &&
			(await maskText(masker, message)).toLowerCase().includes(query)
		)
			return true;
	}
	return false;
};

const matching = async (
	group: Group,
	query: string,
	masker: SecretsMaskAdapter,
) => {
	const head = group.turns.at(-1);
	const first = group.turns[0];
	if (!head || !first) throw new Error("empty conversation group");
	const title = await maskText(masker, first.goal);
	if (
		query !== "" &&
		!title.toLowerCase().includes(query) &&
		!(await matchesMessage(group, query, masker))
	)
		return undefined;
	return { ...summary(group), title, head: await maskView(masker, head) };
};

const pageOf = (
	conversations: ConversationThread[],
	limit: number,
): ThreadListResult => {
	const more = conversations.length > limit;
	const page = conversations.slice(0, limit);
	const last = page.at(-1);
	return {
		conversations: page,
		...(more && last
			? { nextCursor: { id: last.id, updatedAt: last.updatedAt } }
			: {}),
	};
};

const list = async (
	s: EngineState,
	input: z.infer<typeof ThreadListInputSchema>,
	masker: SecretsMaskAdapter,
): Promise<Result<ThreadListResult, EngineError>> => {
	const query = input.query.toLowerCase();
	const candidates = groups(s, query !== "").sort((a, b) =>
		order(summary(a), summary(b)),
	);
	let matches: { group: Group; conversation: ConversationThread }[] = [];
	for (const group of candidates) {
		if (input.cursor && order(summary(group), input.cursor) <= 0) continue;
		const found = await matching(group, query, masker);
		if (found) matches.push({ group, conversation: found });
		matches = matches.filter((match) => retained(s, match.group));
		if (matches.length > input.limit) break;
	}
	const conversations = matches.map((match) => match.conversation);
	return ok(pageOf(conversations, input.limit));
};

const read = async (
	s: EngineState,
	runId: string,
	masker: SecretsMaskAdapter,
) => {
	const group = groups(s).find((group) =>
		group.turns.some((run) => run.id === runId),
	);
	if (!group)
		return err<EngineError>({
			code: "not_found",
			message: "conversation run not found",
		});
	const turns = await Promise.all(
		group.turns.map((run) => maskView(masker, run)),
	);
	if (!retained(s, group))
		return err<EngineError>({
			code: "not_found",
			message: "conversation changed during read",
		});
	return ok({ conversation: summary({ ...group, turns }), turns });
};

/** Read-only local metadata and authored-message search; missing masking fails closed. */
export const createThreadReads = (
	s: EngineState,
): Pick<ConversationThreadAdapter, "read" | "list"> => {
	const guarded = async <T>(
		operation: (masker: SecretsMaskAdapter) => Promise<Result<T, EngineError>>,
	) => {
		const chain = s.deps.registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
		if (!chain.ok)
			return err<EngineError>({
				code: "not_supported",
				message: "conversation masking is unavailable",
			});
		try {
			return await operation(chain.value[0].impl);
		} catch {
			return err<EngineError>({
				code: "failed",
				message: "conversation history could not be read",
			});
		}
	};
	return {
		list: async (input) => {
			const parsed = ThreadListInputSchema.safeParse(input);
			if (!parsed.success)
				return err({
					code: "bad_input",
					message: z.prettifyError(parsed.error),
				});
			return guarded((masker) => list(s, parsed.data, masker));
		},
		read: async (input) => {
			const parsed = ThreadReadInputSchema.safeParse(input);
			if (!parsed.success)
				return err({
					code: "bad_input",
					message: z.prettifyError(parsed.error),
				});
			return guarded((masker) => read(s, parsed.data.runId, masker));
		},
	};
};
