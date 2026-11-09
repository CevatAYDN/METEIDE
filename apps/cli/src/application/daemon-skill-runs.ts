import {
	type ConversationThreadV3Adapter,
	DAEMON_METHODS,
	DaemonRunSkillsStartParamsSchema,
	DaemonRunSkillsStartResultSchema,
	DaemonThreadSkillsReplyParamsSchema,
	DaemonThreadSkillsReplyResultSchema,
	DaemonThreadSkillsStartParamsSchema,
	DaemonThreadSkillsStartResultSchema,
	type EngineError,
	type Result,
	type RunSkillsAdapter,
} from "@mete/contracts";
import {
	ErrorCodes,
	type MessageConnection,
	ResponseError,
} from "vscode-jsonrpc/node";
import type { z } from "zod";
import type { App } from "../infrastructure/app.js";
import { refused } from "./daemon-errors.js";

type MutationApp = Pick<App, "registry">;
const unavailable = () =>
	refused({ code: "not_supported", message: "Skill runs are unavailable." });
const stale = () =>
	refused({
		code: "bad_input",
		message: "This daemon session ended; reconnect and send again.",
	});

const portOf = <C>(
	app: MutationApp,
	ref: "conversation.thread@3" | "run.skills@1",
): C => {
	const found = app.registry.resolve<C>(ref);
	if (!found.ok) throw unavailable();
	return found.value[0].impl;
};

/**
 * One session-bound mutation route. The session id is checked and removed before the port sees
 * the input, and selections are never stripped: a refusal is returned, not a plain resend.
 */
const route = <P extends { sessionId: string }, O>(
	connection: MessageConnection,
	sessionId: string,
	spec: {
		name: string;
		input: z.ZodType<P>;
		output: z.ZodType<O>;
		call: (input: Omit<P, "sessionId">) => Promise<Result<O, EngineError>>;
	},
) =>
	connection.onRequest(spec.name, async (params: unknown) => {
		const parsed = spec.input.safeParse(params);
		if (!parsed.success)
			throw new ResponseError(
				ErrorCodes.InvalidParams,
				"Invalid skill request.",
			);
		const { sessionId: claimed, ...input } = parsed.data;
		if (claimed !== sessionId) throw stale();
		const result = await spec.call(input);
		if (!result.ok) throw refused(result.error);
		const output = spec.output.safeParse(result.value);
		if (!output.success)
			throw refused({ code: "failed", message: "Invalid skill response." });
		return output.data;
	});

/** S2 mutation routes (T2, ADR-190): thread@3 start/reply and run.skills@1 start. */
export const serveSkillMutations = (
	connection: MessageConnection,
	app: MutationApp,
	sessionId: string,
) => {
	const thread = () =>
		portOf<ConversationThreadV3Adapter>(app, "conversation.thread@3");
	const runs = () => portOf<RunSkillsAdapter>(app, "run.skills@1");
	const handlers = [
		route(connection, sessionId, {
			name: DAEMON_METHODS.threadSkillsStart,
			input: DaemonThreadSkillsStartParamsSchema,
			output: DaemonThreadSkillsStartResultSchema,
			call: (input) => thread().start(input),
		}),
		route(connection, sessionId, {
			name: DAEMON_METHODS.threadSkillsReply,
			input: DaemonThreadSkillsReplyParamsSchema,
			output: DaemonThreadSkillsReplyResultSchema,
			call: (input) => thread().reply(input),
		}),
		route(connection, sessionId, {
			name: DAEMON_METHODS.runSkillsStart,
			input: DaemonRunSkillsStartParamsSchema,
			output: DaemonRunSkillsStartResultSchema,
			call: (input) => runs().start(input),
		}),
	];
	return () => {
		for (const handler of handlers) handler.dispose();
	};
};
