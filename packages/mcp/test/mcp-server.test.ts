import {
	type ApprovalInput,
	err,
	type MeteEvent,
	ModuleManifestSchema,
	ok,
	type RunStart,
	type RunView,
	type TeamEngineAdapter,
} from "@mete/contracts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { runProgress } from "../src/domain/run-view.js";
import { createMcpServerModule } from "../src/server-module.js";
import { moduleContext } from "./helpers/context.js";

const RUN = "00000000-0000-4000-8000-000000000001";
const TASK = "00000000-0000-4000-8000-000000000002";

const event = (type: string, payload: object, taskId?: string) =>
	({
		id: crypto.randomUUID(),
		ts: "2026-10-22T10:00:00.000Z",
		schema: 1,
		workspaceId: RUN,
		runId: RUN,
		...(taskId ? { taskId } : {}),
		source: "core-engine",
		type,
		payload,
	}) as MeteEvent;

const EVENTS = [
	event(
		"task.created",
		{ title: "Audit", roleId: "auditor", dependsOn: [] },
		TASK,
	),
	event("task.status.changed", { from: "todo", to: "approved" }, TASK),
	event("artifact.created", {
		artifactId: TASK,
		type: "seo-audit@1",
		path: "a.json",
	}),
	event("artifact.updated", {
		artifactId: TASK,
		type: "seo-audit@1",
		path: "b.json",
	}),
	event("run.completed", { summary: "done" }),
];

const VIEW = { id: RUN, status: "completed" } as RunView;

const fakeEngine = () => {
	const calls: unknown[] = [];
	const engine = {
		start: async (req: RunStart) => {
			calls.push(req);
			return req.templateId === "nope"
				? err({
						code: "choose_template",
						message: "Which one?",
						suggestions: ["a", "b"],
					})
				: ok({ runId: RUN });
		},
		approve: async (runId: string, input: ApprovalInput) => {
			calls.push({ runId, ...input });
			return ok(undefined);
		},
		status: (runId?: string) =>
			runId === RUN
				? ok([VIEW])
				: err({ code: "not_found", message: `no run ${runId}` }),
	} as Partial<TeamEngineAdapter> as TeamEngineAdapter;
	return { engine, calls };
};

const serve = async () => {
	const [mine, theirs] = InMemoryTransport.createLinkedPair();
	const module = createMcpServerModule({
		transport: mine,
		history: () => ({ events: EVENTS, broken: [] }),
	});
	const { ctx, registry } = moduleContext("allow");
	const { engine, calls } = fakeEngine();
	registry.provide("team.engine@2", {
		id: "core-engine",
		trust: "core",
		features: [],
		impl: engine,
	});
	await module.activate(ctx);
	const client = new Client({ name: "test", version: "0" });
	await client.connect(theirs);
	const call = (name: string, args: Record<string, unknown>) =>
		client.callTool({ name, arguments: args });
	return { module, client, call, calls };
};

describe("mcp-server", () => {
	let s: Awaited<ReturnType<typeof serve>> | undefined;
	afterEach(async () => {
		await s?.client.close();
		await s?.module.deactivate();
	});

	it("has a valid manifest and lists its four tools", async () => {
		s = await serve();
		expect(ModuleManifestSchema.safeParse(s.module.manifest).success).toBe(
			true,
		);
		const { tools } = await s.client.listTools();
		expect(tools.map((t) => t.name)).toEqual([
			"mete_run_team",
			"mete_task_status",
			"mete_approve",
			"mete_knowledge_search",
		]);
	});

	it("starts a run and answers a refused one with the template choices", async () => {
		s = await serve();
		const started = await s.call("mete_run_team", {
			goal: "audit",
			templateId: "seo-audit",
		});
		expect(started.structuredContent).toEqual({ runId: RUN });
		const refused = await s.call("mete_run_team", {
			goal: "audit",
			templateId: "nope",
		});
		expect(refused.isError).toBe(true);
		expect(JSON.stringify(refused.content)).toContain("Templates: a, b");
	});

	it("reports a run's status, tasks, output and artifacts", async () => {
		s = await serve();
		const r = await s.call("mete_task_status", { runId: RUN });
		expect(r.structuredContent).toEqual({
			status: "completed",
			tasks: [{ id: TASK, title: "Audit", status: "approved" }],
			output: "done",
			artifacts: ["b.json"],
		});
		const missing = await s.call("mete_task_status", { runId: "other" });
		expect(missing.isError).toBe(true);
	});

	it("passes an approval on and refuses a revision without feedback", async () => {
		s = await serve();
		expect(
			(await s.call("mete_approve", { runId: RUN, decision: "approve" }))
				.isError,
		).toBeFalsy();
		const bad = await s.call("mete_approve", {
			runId: RUN,
			decision: "revise",
		});
		expect(bad.isError).toBe(true);
		expect(s.calls).toEqual([{ runId: RUN, decision: "approve" }]);
	});

	it("says knowledge search is not there yet", async () => {
		s = await serve();
		const r = await s.call("mete_knowledge_search", { query: "x" });
		expect(r.isError).toBe(true);
		expect(JSON.stringify(r.content)).toContain("Phase 4");
	});
});

describe("runProgress", () => {
	it("keeps a failed run's reason", () => {
		const failed = runProgress([
			event("run.failed", { code: "io", message: "down" }),
		]);
		expect(failed).toEqual({ tasks: [], artifacts: [], failure: "io: down" });
	});
});
