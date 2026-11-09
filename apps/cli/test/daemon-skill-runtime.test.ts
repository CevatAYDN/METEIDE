import { randomUUID } from "node:crypto";
import {
	type ConversationThreadV3Adapter,
	DAEMON_METHODS,
	DaemonRunSkillsReadResultSchema,
	DaemonSkillsListResultSchema,
	DaemonSkillsRuntimeResultSchema,
	err,
	ok,
	type RunSkillsAdapter,
	type SkillRuntimeAdapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skillProtocol } from "./skill-protocol-fixture.js";

const fixtures: ReturnType<typeof skillProtocol>[] = [];
afterEach(async () => {
	for (const fixture of fixtures.splice(0)) await fixture.close();
});
const version = {
	sourceId: "a".repeat(64),
	sha256: "b".repeat(64),
	revision: 1,
};
const started = { conversationId: randomUUID(), runId: randomUUID() };
const core = { id: "core-engine", trust: "core" as const, features: [] };

const setup = () => {
	const t = skillProtocol(true);
	fixtures.push(t);
	const unused = async () => err({ code: "unavailable" as const });
	const catalog = vi.fn<SkillRuntimeAdapter["catalog"]>(async () =>
		ok({ status: "ready", entries: [], diagnostics: [] }),
	);
	t.registry.provide<SkillRuntimeAdapter>("skill.runtime@1", {
		...core,
		impl: { catalog, load: unused, check: unused, inventory: unused },
	});
	const threadStart = vi.fn<ConversationThreadV3Adapter["start"]>(async () =>
		ok(started),
	);
	const threadReply = vi.fn<ConversationThreadV3Adapter["reply"]>(async () =>
		ok(started),
	);
	t.registry.provide<Pick<ConversationThreadV3Adapter, "start" | "reply">>(
		"conversation.thread@3",
		{ ...core, impl: { start: threadStart, reply: threadReply } },
	);
	const read = vi.fn<RunSkillsAdapter["read"]>(async ({ runId }) =>
		ok({ kind: "legacy", runId }),
	);
	const runStart = vi.fn<RunSkillsAdapter["start"]>(async () =>
		ok({ runId: started.runId }),
	);
	t.registry.provide<RunSkillsAdapter>("run.skills@1", {
		...core,
		impl: { start: runStart, read },
	});
	return { t, catalog, threadStart, threadReply, read, runStart };
};
const sessionOf = async (s: ReturnType<typeof setup>) => {
	const r = DaemonSkillsListResultSchema.parse(
		await s.t.client.sendRequest(DAEMON_METHODS.skillsList, {}),
	);
	if (!r.ok) throw new Error("inventory failed");
	return r.value.sessionId;
};

describe("daemon S2 routes (T2)", () => {
	it("serves the runtime catalog with the connection's session id", async () => {
		const s = setup();
		const sessionId = await sessionOf(s);
		const r = DaemonSkillsRuntimeResultSchema.parse(
			await s.t.client.sendRequest(DAEMON_METHODS.skillsRuntime, {}),
		);
		expect(r).toEqual({
			ok: true,
			value: {
				sessionId,
				catalog: { status: "ready", entries: [], diagnostics: [] },
			},
		});
	});

	it("passes the exact selection through and strips only the session id", async () => {
		const s = setup();
		const sessionId = await sessionOf(s);
		const requestId = randomUUID();
		expect(
			await s.t.client.sendRequest(DAEMON_METHODS.threadSkillsStart, {
				sessionId,
				requestId,
				goal: "hello",
				skills: { mode: "manual", selected: [version] },
			}),
		).toEqual(started);
		expect(s.threadStart).toHaveBeenCalledWith(
			expect.objectContaining({
				requestId,
				skills: { mode: "manual", selected: [version] },
			}),
		);
		expect(s.threadStart.mock.calls[0]?.[0]).not.toHaveProperty("sessionId");
	});

	it("keeps an omitted reply policy omitted, so only the mode is inherited", async () => {
		const s = setup();
		const sessionId = await sessionOf(s);
		await s.t.client.sendRequest(DAEMON_METHODS.threadSkillsReply, {
			sessionId,
			requestId: randomUUID(),
			conversationId: started.conversationId,
			expectedRunId: started.runId,
			message: "next",
		});
		expect(s.threadReply.mock.calls[0]?.[0]).not.toHaveProperty("skills");
	});

	it("refuses a stale session before any mutation dispatch", async () => {
		const s = setup();
		await expect(
			s.t.client.sendRequest(DAEMON_METHODS.runSkillsStart, {
				sessionId: randomUUID(),
				goal: "hello",
				templateId: null,
			}),
		).rejects.toThrow(/session ended/);
		expect(s.runStart).not.toHaveBeenCalled();
	});

	it("reads authoritative run skills, and a failure is an error, never empty", async () => {
		const s = setup();
		const runId = randomUUID();
		expect(
			DaemonRunSkillsReadResultSchema.parse(
				await s.t.client.sendRequest(DAEMON_METHODS.runSkillsRead, { runId }),
			),
		).toEqual({ ok: true, value: { kind: "legacy", runId } });
		s.read.mockResolvedValueOnce(err({ code: "integrity_failed" }));
		expect(
			await s.t.client.sendRequest(DAEMON_METHODS.runSkillsRead, { runId }),
		).toEqual({ ok: false, error: { code: "integrity_failed" } });
	});
});
