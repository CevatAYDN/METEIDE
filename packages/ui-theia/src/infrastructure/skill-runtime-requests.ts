import {
	DAEMON_METHODS,
	DaemonRunSkillsReadResultSchema,
	DaemonSkillsRuntimeResultSchema,
	err,
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
	deps: Deps,
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

/** Runtime reads validate shapes and requested identities before exposing evidence to the UI. */
export const skillRuntimeRequests = (deps: Deps): SkillRuntimeService => ({
	skillsRuntime: (dir) =>
		read(deps, dir, {
			method: DAEMON_METHODS.skillsRuntime,
			input: {},
			schema: DaemonSkillsRuntimeResultSchema,
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
});
