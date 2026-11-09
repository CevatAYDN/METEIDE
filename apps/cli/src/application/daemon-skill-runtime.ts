import {
	DAEMON_METHODS,
	DaemonRunSkillsReadParamsSchema,
	type DaemonRunSkillsReadResult,
	DaemonRunSkillsReadResultSchema,
	DaemonSkillsRuntimeParamsSchema,
	type DaemonSkillsRuntimeResult,
	DaemonSkillsRuntimeResultSchema,
	err,
	type RunSkillsAdapter,
	type SkillRuntimeAdapter,
	type SkillRuntimeError,
} from "@mete/contracts";
import type { MessageConnection } from "vscode-jsonrpc/node";
import type { App } from "../infrastructure/app.js";
import { skillBinding } from "./daemon-skill-binding.js";

type RuntimeApp = Pick<App, "registry">;
const failure = (code: SkillRuntimeError["code"]) => err({ code });

const portOf = <C>(
	app: RuntimeApp,
	ref: "skill.runtime@1" | "run.skills@1",
): C | undefined => {
	const found = app.registry.resolve<C>(ref);
	return found.ok ? found.value[0].impl : undefined;
};

/** Read-only catalog with this connection's session identity; refusal is never empty. */
const runtimeCatalog = async (
	app: RuntimeApp,
	sessionId: string,
	signal: AbortSignal,
): Promise<DaemonSkillsRuntimeResult> => {
	const runtime = portOf<SkillRuntimeAdapter>(app, "skill.runtime@1");
	if (!runtime) return failure("unavailable");
	const result = await runtime.catalog(signal);
	return result.ok
		? { ok: true, value: { sessionId, catalog: result.value } }
		: result;
};

const runRead = async (
	app: RuntimeApp,
	input: Parameters<RunSkillsAdapter["read"]>[0],
): Promise<DaemonRunSkillsReadResult> => {
	const port = portOf<RunSkillsAdapter>(app, "run.skills@1");
	return port ? port.read(input) : failure("unavailable");
};

/** S2 read routes (T2, ADR-190). Mutations are served by `serveSkillMutations`. */
export const serveSkillRuntime = (
	connection: MessageConnection,
	app: RuntimeApp,
	sessionId: string,
) => {
	const routes = skillBinding(connection);
	routes.bind(DAEMON_METHODS.skillsRuntime, {
		input: DaemonSkillsRuntimeParamsSchema,
		output: DaemonSkillsRuntimeResultSchema,
		failure,
		invoke: (_, signal) => runtimeCatalog(app, sessionId, signal),
	});
	routes.bind(DAEMON_METHODS.runSkillsRead, {
		input: DaemonRunSkillsReadParamsSchema,
		output: DaemonRunSkillsReadResultSchema,
		failure,
		invoke: (input) => runRead(app, input),
	});
	return routes.dispose;
};
