import {
	type ApprovalInput,
	ApprovalInputSchema,
	DecisionSchema,
	type EngineError,
	type MeteEvent,
	RunStatusSchema,
	type RunView,
	TaskStatusSchema,
	type TeamEngineAdapter,
} from "@mete/contracts";
import type { Logger } from "@mete/kernel";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { runProgress } from "../domain/run-view.js";

// The tools of METE as an MCP server (docs/10): teams run here, answers come back as tool results.

/** A run's persisted events and the rows that no longer parse, or undefined when none can be read. */
// shortcut: the CLI reads storage's events table for this, as for `mete events`; an events-read capability comes with the desktop.
export type RunHistory = (runId: string) =>
	| {
			readonly events: readonly MeteEvent[];
			readonly broken: readonly { seq: number; issues: string }[];
	  }
	| undefined;

export type MeteToolDeps = {
	readonly engine: () => TeamEngineAdapter | undefined;
	readonly history: RunHistory;
	readonly logger: Logger;
};

const failed = (text: string): CallToolResult => ({
	content: [{ type: "text", text }],
	isError: true,
});

const refused = (e: EngineError) =>
	failed(
		e.code === "choose_template"
			? `${e.code}: ${e.message} Templates: ${e.suggestions.join(", ")}`
			: `${e.code}: ${e.message}`,
	);

const answer = <T extends Record<string, unknown>>(
	value: T,
): CallToolResult => ({
	content: [{ type: "text", text: JSON.stringify(value) }],
	structuredContent: value,
});

const NO_ENGINE = "team.engine@2 is not active";

const StatusOutput = z.object({
	status: RunStatusSchema,
	reason: z.string().optional(),
	tasks: z.array(
		z.object({ id: z.string(), title: z.string(), status: TaskStatusSchema }),
	),
	output: z.string().optional(),
	artifacts: z.array(z.string()),
});

const runTeam =
	(deps: MeteToolDeps) =>
	async (args: { goal: string; templateId?: string | undefined }) => {
		const engine = deps.engine();
		if (!engine) return failed(NO_ENGINE);
		const { goal, templateId } = args;
		const r = await engine.start(templateId ? { goal, templateId } : { goal });
		return r.ok ? answer({ runId: r.value.runId }) : refused(r.error);
	};

const taskStatus =
	(deps: MeteToolDeps) =>
	async ({ runId }: { runId: string }) => {
		const engine = deps.engine();
		if (!engine) return failed(NO_ENGINE);
		const view = engine.status(runId);
		if (!view.ok) return refused(view.error);
		const h = deps.history(runId);
		if (!h) return failed(`the events of run ${runId} cannot be read`);
		for (const b of h.broken)
			deps.logger.warn(
				{ runId, seq: b.seq, reason: b.issues },
				"run event cannot be read",
			);
		const run = view.value[0];
		if (!run) return failed(`not_found: no run ${runId}`);
		return answer(statusOf(run, h.events));
	};

// The engine knows the run's state; its events tell the tasks, artifacts, output and failure.
const statusOf = (run: RunView, events: readonly MeteEvent[]) => {
	const { failure, ...progress } = runProgress(events);
	const reason = run.pauseReason ?? failure;
	return {
		status: run.status,
		...(reason ? { reason } : {}),
		...progress,
	};
};

const approve =
	(deps: MeteToolDeps) => async (args: ApprovalInput & { runId: string }) => {
		const engine = deps.engine();
		if (!engine) return failed(NO_ENGINE);
		const { runId, ...input } = args;
		const parsed = ApprovalInputSchema.safeParse(input);
		if (!parsed.success)
			return failed(
				`bad_input: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
			);
		const r = await engine.approve(runId, parsed.data);
		return r.ok ? answer({ runId }) : refused(r.error);
	};

/** Registers mete_run_team, mete_task_status, mete_approve and mete_knowledge_search on `server`. */
export const registerMeteTools = (server: McpServer, deps: MeteToolDeps) => {
	server.registerTool(
		"mete_run_team",
		{
			description:
				"Start a METE team run on a goal; returns its runId at once. Poll mete_task_status.",
			inputSchema: z.object({
				goal: z.string().trim().min(1),
				templateId: z.string().min(1).optional(),
			}),
			outputSchema: z.object({ runId: z.string() }),
		},
		runTeam(deps),
	);
	server.registerTool(
		"mete_task_status",
		{
			description:
				"A run's status, its tasks, its output once completed and its artifact paths.",
			inputSchema: z.object({ runId: z.string().min(1) }),
			outputSchema: StatusOutput,
		},
		taskStatus(deps),
	);
	server.registerTool(
		"mete_approve",
		{
			description:
				"Approve or revise the task a paused run waits on; a revision needs feedback.",
			inputSchema: z.object({
				runId: z.string().min(1),
				taskId: z.string().min(1).optional(),
				decision: DecisionSchema,
				feedback: z.string().optional(),
			}),
			outputSchema: z.object({ runId: z.string() }),
		},
		approve(deps),
	);
	server.registerTool(
		"mete_knowledge_search",
		{
			description:
				"Search the workspace knowledge base. Not available until Phase 4.",
			inputSchema: z.object({ query: z.string().min(1) }),
		},
		async () => failed("not_supported: knowledge search comes in Phase 4"),
	);
};
