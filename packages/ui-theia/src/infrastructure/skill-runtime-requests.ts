import {
	DAEMON_METHODS,
	DaemonRunSkillsReadResultSchema,
	DaemonRunSkillsStartParamsSchema,
	DaemonRunSkillsStartResultSchema,
	DaemonSkillsRuntimeResultSchema,
	DaemonThreadSkillsReplyParamsSchema,
	DaemonThreadSkillsReplyResultSchema,
	DaemonThreadSkillsStartParamsSchema,
	DaemonThreadSkillsStartResultSchema,
	err,
	ok,
	type Result,
	RunSkillsReadInputSchema,
} from "@mete/contracts";
import type { z } from "zod";
import type { DaemonFailure } from "../domain/daemon-failure.js";
import type { SkillRuntimeService } from "../domain/skill-runtime-service.js";
import type { SkillTransport } from "./skill-requests.js";

type Deps = {
	readonly acquire: (
		dir: string,
	) => Promise<Result<SkillTransport, DaemonFailure>>;
	readonly current: (dir: string) => SkillTransport | undefined;
};
const invalid = () =>
	err({ code: "protocol" as const, detail: "Invalid skill runtime evidence" });
const stale = () =>
	err({
		code: "stopped" as const,
		detail: "The skill runtime connection changed",
	});

/** Reads stay bound to the acquired process across the await; no fallback or replay. */
const read = async <T>(
	deps: Pick<Deps, "acquire">,
	dir: string,
	request: { method: string; input: object; schema: z.ZodType<T> },
): Promise<Result<T, DaemonFailure>> => {
	const acquired = await deps.acquire(dir);
	if (!acquired.ok) return acquired;
	const transport = acquired.value;
	if (!transport.current()) return stale();
	try {
		const result = await transport.send(request.method, request.input, (raw) =>
			request.schema.safeParse(raw),
		);
		return transport.current() ? result : stale();
	} catch {
		return transport.current() ? invalid() : stale();
	}
};

type Origins = Map<string, { sessionId: string; transport: SkillTransport }>;
const sessionSender =
	(deps: Deps, origins: Origins) =>
	async <I extends { sessionId: string }, O>(
		dir: string,
		input: I,
		spec: { method: string; input: z.ZodType<I>; output: z.ZodType<O> },
	): Promise<Result<O, DaemonFailure>> => {
		const parsed = spec.input.safeParse(input);
		if (!parsed.success) return invalid();
		const origin = origins.get(dir);
		if (
			!origin ||
			origin.sessionId !== parsed.data.sessionId ||
			deps.current(dir)?.identity !== origin.transport.identity ||
			!origin.transport.current()
		)
			return stale();
		return read({ acquire: async () => ok(origin.transport) }, dir, {
			method: spec.method,
			input: parsed.data,
			schema: spec.output,
		});
	};
const runtimeReader =
	(deps: Deps, origins: Origins): SkillRuntimeService["skillsRuntime"] =>
	async (dir) => {
		const acquired = await deps.acquire(dir);
		if (!acquired.ok) return acquired;
		const result = await read({ acquire: async () => acquired }, dir, {
			method: DAEMON_METHODS.skillsRuntime,
			input: {},
			schema: DaemonSkillsRuntimeResultSchema,
		});
		if (result.ok && result.value.ok)
			origins.set(dir, {
				sessionId: result.value.value.sessionId,
				transport: acquired.value,
			});
		return result;
	};

/** Runtime reads validate identities; mutations send only to their discovered session. */
export const skillRuntimeRequests = (deps: Deps): SkillRuntimeService => {
	const origins: Origins = new Map();
	const send = sessionSender(deps, origins);
	return {
		skillsRuntime: runtimeReader(deps, origins),
		threadSkillsStart: (dir, input) =>
			send(dir, input, {
				method: DAEMON_METHODS.threadSkillsStart,
				input: DaemonThreadSkillsStartParamsSchema,
				output: DaemonThreadSkillsStartResultSchema,
			}),
		threadSkillsReply: (dir, input) =>
			send(dir, input, {
				method: DAEMON_METHODS.threadSkillsReply,
				input: DaemonThreadSkillsReplyParamsSchema,
				output: DaemonThreadSkillsReplyResultSchema.refine(
					(value) => value.conversationId === input.conversationId,
				),
			}),
		runSkillsStart: (dir, input) =>
			send(dir, input, {
				method: DAEMON_METHODS.runSkillsStart,
				input: DaemonRunSkillsStartParamsSchema,
				output: DaemonRunSkillsStartResultSchema,
			}),
		runSkillsRead: async (dir, input) => {
			const parsed = RunSkillsReadInputSchema.safeParse(input);
			if (!parsed.success) return invalid();
			return read(deps, dir, {
				method: DAEMON_METHODS.runSkillsRead,
				input: parsed.data,
				schema: DaemonRunSkillsReadResultSchema.refine((result) => {
					if (!result.ok) return true;
					const { value } = result;
					if (value.runId !== parsed.data.runId) return false;
					return parsed.data.contextId
						? value.kind === "context" &&
								value.context.owner.contextId === parsed.data.contextId
						: value.kind !== "context";
				}),
			});
		},
	};
};
