import { randomUUID } from "node:crypto";
import {
	DAEMON_METHODS,
	type DaemonSkillsApproveParams,
	DaemonSkillsApproveParamsSchema,
	DaemonSkillsApproveResultSchema,
	type DaemonSkillsDisableParams,
	DaemonSkillsDisableParamsSchema,
	DaemonSkillsDisableResultSchema,
	DaemonSkillsEditorParamsSchema,
	DaemonSkillsEditorResultSchema,
	DaemonSkillsListParamsSchema,
	DaemonSkillsListResultSchema,
	DaemonSkillsPrepareParamsSchema,
	DaemonSkillsPrepareResultSchema,
	err,
	type SkillError,
} from "@mete/contracts";
import type { MessageConnection } from "vscode-jsonrpc/node";
import type { SkillApp } from "./daemon-skill-adapter.js";
import { skillBinding } from "./daemon-skill-binding.js";
import { resolveSkillEditor } from "./daemon-skill-editor.js";
import { mutateSkill, skillMutationFailure } from "./daemon-skill-mutations.js";
import { listSkills, prepareSkill } from "./daemon-skill-reads.js";

const failure = (code: SkillError["code"]) => err({ code });

const approveInSession = (
	app: SkillApp,
	sessionId: string,
	input: DaemonSkillsApproveParams,
	signal: AbortSignal,
) =>
	input.sessionId === sessionId
		? mutateSkill(
				app,
				{
					op: "approve",
					value: { previewId: input.previewId },
				},
				signal,
			)
		: Promise.resolve(skillMutationFailure("stale"));

const disableInSession = (
	app: SkillApp,
	sessionId: string,
	input: DaemonSkillsDisableParams,
	signal: AbortSignal,
) =>
	input.sessionId === sessionId
		? mutateSkill(
				app,
				{
					op: "disable",
					value: {
						sourceId: input.sourceId,
						expectedRevision: input.expectedRevision,
					},
				},
				signal,
			)
		: Promise.resolve(skillMutationFailure("stale"));

const bindMutations = (
	routes: ReturnType<typeof skillBinding>,
	app: SkillApp,
	sessionId: string,
) => {
	routes.bind(DAEMON_METHODS.skillsApprove, {
		input: DaemonSkillsApproveParamsSchema,
		output: DaemonSkillsApproveResultSchema,
		failure: skillMutationFailure,
		invoke: (input, signal) => approveInSession(app, sessionId, input, signal),
	});
	routes.bind(DAEMON_METHODS.skillsDisable, {
		input: DaemonSkillsDisableParamsSchema,
		output: DaemonSkillsDisableResultSchema,
		failure: skillMutationFailure,
		invoke: (input, signal) => disableInSession(app, sessionId, input, signal),
	});
};

/** Register skill routes once; the host owns retirement after receiving admission. */
export const serveSkills = (connection: MessageConnection, app: SkillApp) => {
	const sessionId = randomUUID();
	const routes = skillBinding(connection);
	routes.bind(DAEMON_METHODS.skillsList, {
		input: DaemonSkillsListParamsSchema,
		output: DaemonSkillsListResultSchema,
		failure,
		invoke: (_, signal) => listSkills(app, sessionId, signal),
	});
	routes.bind(DAEMON_METHODS.skillsPrepare, {
		input: DaemonSkillsPrepareParamsSchema,
		output: DaemonSkillsPrepareResultSchema,
		failure,
		invoke: (input, signal) =>
			input.sessionId === sessionId
				? prepareSkill(app, sessionId, { sourceId: input.sourceId }, signal)
				: Promise.resolve(failure("stale")),
	});
	routes.bind(DAEMON_METHODS.skillsEditor, {
		input: DaemonSkillsEditorParamsSchema,
		output: DaemonSkillsEditorResultSchema,
		failure,
		invoke: (input, signal) =>
			resolveSkillEditor(app, sessionId, input, signal),
	});
	bindMutations(routes, app, sessionId);
	return routes.dispose;
};
