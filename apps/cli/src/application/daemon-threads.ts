import {
	type ConversationThreadAdapter,
	DAEMON_METHODS,
	type EngineError,
	type Result,
	type SecretsMaskAdapter,
	ThreadListInputSchema,
	ThreadListResultSchema,
	ThreadReadInputSchema,
	ThreadReadResultSchema,
	ThreadReplyInputSchema,
	ThreadStartedSchema,
	ThreadStartInputSchema,
} from "@mete/contracts";
import {
	ErrorCodes,
	type MessageConnection,
	ResponseError,
} from "vscode-jsonrpc/node";
import type { z } from "zod";
import type { App } from "../infrastructure/app.js";
import { refused } from "./daemon-errors.js";

type ThreadApp = Pick<App, "registry">;
const portOf = (app: ThreadApp): ConversationThreadAdapter => {
	const chain = app.registry.resolve<ConversationThreadAdapter>(
		"conversation.thread@1",
	);
	if (!chain.ok)
		throw refused({
			code: "not_supported",
			message: "Conversation history is not available.",
		});
	return chain.value[0].impl;
};
const failure = async (app: ThreadApp, error: EngineError) => {
	const mask = app.registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
	const message = mask.ok
		? (await mask.value[0].impl.mask(error.message)).text
		: "Conversation request failed.";
	return refused({ ...error, message });
};
const route = <I, O>(
	connection: MessageConnection,
	app: ThreadApp,
	spec: {
		name: string;
		input: z.ZodType<I>;
		output: z.ZodType<O>;
		call: (
			port: ConversationThreadAdapter,
			input: I,
		) => Promise<Result<O, EngineError>>;
	},
) =>
	connection.onRequest(spec.name, async (params: unknown) => {
		const input = spec.input.safeParse(params);
		if (!input.success)
			throw new ResponseError(
				ErrorCodes.InvalidParams,
				"Invalid conversation request.",
			);
		const out = await spec.call(portOf(app), input.data);
		if (!out.ok) throw await failure(app, out.error);
		const result = spec.output.safeParse(out.value);
		if (!result.success)
			throw refused({
				code: "failed",
				message: "Invalid conversation response.",
			});
		return result.data;
	});

/** Protocol31 thread handlers never downgrade an idempotent request to a legacy send. */
export const serveConversationThreads = (
	connection: MessageConnection,
	app: ThreadApp,
) => {
	const handlers = [
		route(connection, app, {
			name: DAEMON_METHODS.threadStart,
			input: ThreadStartInputSchema,
			output: ThreadStartedSchema,
			call: (port, input) => port.start(input),
		}),
		route(connection, app, {
			name: DAEMON_METHODS.threadReply,
			input: ThreadReplyInputSchema,
			output: ThreadStartedSchema,
			call: (port, input) => port.reply(input),
		}),
		route(connection, app, {
			name: DAEMON_METHODS.threadList,
			input: ThreadListInputSchema,
			output: ThreadListResultSchema,
			call: (port, input) => port.list(input),
		}),
		route(connection, app, {
			name: DAEMON_METHODS.threadRead,
			input: ThreadReadInputSchema,
			output: ThreadReadResultSchema,
			call: (port, input) => port.read(input),
		}),
	];
	return {
		dispose: () => {
			for (const handler of handlers) handler.dispose();
		},
	};
};
