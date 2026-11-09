import { createHash } from "node:crypto";
import type { z } from "zod";
import type { TaskWaitSchema } from "./task-wait-schema.js";
import type { TeamState } from "./team-schema.js";

/** Pending identity changes whenever the attempt, report or blocking question changes. */
export const waitSignature = (entry: TeamState["tasks"][string]): string =>
	createHash("sha256")
		.update(
			JSON.stringify([
				entry.status,
				entry.context.agentId,
				entry.context.revisions,
				entry.context.blocked,
				entry.context.clarify,
				entry.context.report,
				entry.messages.at(-1),
				entry.attempts?.id,
				entry.verification?.evaluationId,
			]),
		)
		.digest("hex");

/** True only while the stored request still belongs to this task state. */
export const currentWait = (entry: TeamState["tasks"][string] | undefined) =>
	entry?.wait && entry.wait.signature === waitSignature(entry)
		? entry.wait
		: undefined;

/** Replaces one task's pending request without replacing peer state. */
export const withTaskWait = (
	team: TeamState,
	id: string,
	wait: z.infer<typeof TaskWaitSchema> | undefined,
): TeamState => {
	const entry = team.tasks[id];
	return entry
		? { ...team, tasks: { ...team.tasks, [id]: { ...entry, wait } } }
		: team;
};
