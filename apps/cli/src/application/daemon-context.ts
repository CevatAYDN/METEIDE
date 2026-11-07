import {
	ContextDraftSchema,
	ContextSnapshotSchema,
	type ConversationThreadV2Adapter,
	DAEMON_METHODS,
	type EngineError,
	type Result,
	RunStatusSchema,
	type SecretsMaskAdapter,
	ThreadContextReadResultSchema,
	ThreadContextReplyInputSchema,
	ThreadContextStartInputSchema,
	ThreadReadInputSchema,
	ThreadStartedSchema,
} from "@mete/contracts";
import {
	ErrorCodes,
	type MessageConnection,
	ResponseError,
} from "vscode-jsonrpc/node";
import { z } from "zod";
import type { App } from "../infrastructure/app.js";
import { refused } from "./daemon-errors.js";

type ContextApp = Pick<App, "registry">;
const failed = () =>
	refused({ code: "failed", message: "Context request failed." });
const ContextFailureSchema = z.union([
	z.strictObject({
		code: z.enum(["bad_input", "not_found", "not_supported", "failed"]),
		message: z.string(),
	}),
	z.strictObject({
		code: z.literal("invalid_state"),
		message: z.string(),
		status: RunStatusSchema,
	}),
]);
const ContextResultSchema = z.discriminatedUnion("ok", [
	z.strictObject({ ok: z.literal(true), value: z.unknown() }),
	z.strictObject({ ok: z.literal(false), error: z.unknown() }),
]);
const portOf = (app: ContextApp): ConversationThreadV2Adapter => {
	const chain = app.registry.resolve<ConversationThreadV2Adapter>(
		"conversation.thread@2",
	);
	if (!chain.ok)
		throw refused({
			code: "not_supported",
			message: "Editor context is unavailable.",
		});
	return chain.value[0].impl;
};
const failure = async (app: ContextApp, error: unknown) => {
	try {
		const parsed = ContextFailureSchema.safeParse(error);
		if (!parsed.success) return failed();
		const mask = app.registry.resolve<SecretsMaskAdapter>("secrets.mask@1");
		if (!mask.ok) return failed();
		const message = z
			.string()
			.parse((await mask.value[0].impl.mask(parsed.data.message)).text);
		return refused({ ...parsed.data, message });
	} catch {
		return failed();
	}
};
const invoke = async <I, O>(
	port: ConversationThreadV2Adapter,
	input: I,
	call: (
		port: ConversationThreadV2Adapter,
		input: I,
	) => Promise<Result<O, EngineError>>,
) => {
	try {
		return ContextResultSchema.parse(await call(port, input));
	} catch {
		throw failed();
	}
};
const route = <I, O>(
	connection: MessageConnection,
	app: ContextApp,
	spec: {
		name: string;
		input: z.ZodType<I>;
		output: z.ZodType<O>;
		call: (
			port: ConversationThreadV2Adapter,
			input: I,
		) => Promise<Result<O, EngineError>>;
	},
) =>
	connection.onRequest(spec.name, async (params: unknown) => {
		const input = spec.input.safeParse(params);
		if (!input.success)
			throw new ResponseError(
				ErrorCodes.InvalidParams,
				"Invalid context request.",
			);
		const result = await invoke(portOf(app), input.data, spec.call);
		if (!result.ok) throw await failure(app, result.error);
		const parsed = spec.output.safeParse(result.value);
		if (!parsed.success)
			throw refused({ code: "failed", message: "Invalid context response." });
		return parsed.data;
	});

/** Protocol32 explicit context routes never fall back to a plain-message send. */
export const serveConversationContext = (
	connection: MessageConnection,
	app: ContextApp,
) => {
	const handlers = [
		route(connection, app, {
			name: DAEMON_METHODS.threadContextPrepare,
			input: ContextDraftSchema,
			output: ContextSnapshotSchema,
			call: (port, input) => port.prepare(input),
		}),
		route(connection, app, {
			name: DAEMON_METHODS.threadContextStart,
			input: ThreadContextStartInputSchema,
			output: ThreadStartedSchema,
			call: (port, input) => port.start(input),
		}),
		route(connection, app, {
			name: DAEMON_METHODS.threadContextReply,
			input: ThreadContextReplyInputSchema,
			output: ThreadStartedSchema,
			call: (port, input) => port.reply(input),
		}),
		route(connection, app, {
			name: DAEMON_METHODS.threadContextRead,
			input: ThreadReadInputSchema,
			output: ThreadContextReadResultSchema,
			call: (port, input) => port.context(input),
		}),
	];
	return {
		dispose: () => {
			for (const handler of handlers) handler.dispose();
		},
	};
};
