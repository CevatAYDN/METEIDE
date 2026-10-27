import { describe, expect, it } from "vitest";
import { EVENT_TYPES, parseEvent } from "../../src/domain/events.js";
import { EventTypeSchema } from "../../src/domain/ids.js";

const envelope = (type: string, payload: unknown) => ({
	id: crypto.randomUUID(),
	type,
	ts: new Date().toISOString(),
	schema: 1,
	workspaceId: crypto.randomUUID(),
	source: "core-engine",
	payload,
});

describe("parseEvent", () => {
	it("accepts a catalog event and narrows its payload", () => {
		const r = parseEvent(
			envelope("run.paused", {
				reason: "quota",
				resumesAt: "2026-10-21T10:00:00Z",
			}),
		);
		expect(r.ok).toBe(true);
		if (r.ok && r.value.type === "run.paused")
			expect(r.value.payload.reason).toBe("quota");
	});

	it("accepts a policy ask with its command, and refuses one without its adapter (ADR-121)", () => {
		const asked = {
			action: "shell.exec",
			capability: "shell.exec@1",
			adapterId: "tools-shell",
			rule: "autonomy:1",
			command: "npm install",
		};
		expect(parseEvent(envelope("policy.asked", asked)).ok).toBe(true);
		const { adapterId: _, ...bare } = asked;
		expect(parseEvent(envelope("policy.asked", bare)).ok).toBe(false);
	});

	it("accepts events whose payload is none", () => {
		expect(parseEvent(envelope("network.lost", {})).ok).toBe(true);
	});

	it("rejects an unknown event type", () => {
		const r = parseEvent(envelope("run.exploded", {}));
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.code).toBe("invalid_event");
	});

	it("rejects a payload that breaks its schema", () => {
		expect(parseEvent(envelope("run.paused", { reason: "lunch" })).ok).toBe(
			false,
		);
		expect(parseEvent(envelope("run.started", { extra: 1 })).ok).toBe(false);
		expect(
			parseEvent(
				envelope("quota.consumed", {
					providerId: "nvidia",
					unit: "requests_per_minute",
					amount: -1,
				}),
			).ok,
		).toBe(false);
	});

	it("rejects a broken envelope", () => {
		const e = { ...envelope("run.started", {}), schema: 2 };
		expect(parseEvent(e).ok).toBe(false);
		expect(parseEvent({ ...e, schema: 1, ts: "yesterday" }).ok).toBe(false);
		expect(parseEvent({ ...e, schema: 1, source: "Core Engine" }).ok).toBe(
			false,
		);
		expect(parseEvent(null).ok).toBe(false);
	});

	it("takes a merge failure with or without the conflicting files, and nothing else", () => {
		const base = {
			code: "merge_conflict",
			message: "conflicts",
			branch: "mete/r/t",
		};
		for (const payload of [base, { ...base, paths: ["a.txt"] }])
			expect(parseEvent(envelope("task.merge.failed", payload)).ok).toBe(true);
		expect(
			parseEvent(envelope("task.merge.failed", { ...base, extra: 1 })).ok,
		).toBe(false);
		expect(
			parseEvent(envelope("task.merge.failed", { code: "io", message: "m" }))
				.ok,
		).toBe(false);
	});

	it("takes the worktree a task's submission waits in on the request, not on the answer (ADR-132)", () => {
		const asked = { approver: "human" };
		for (const payload of [asked, { ...asked, worktree: "/w/run/task" }])
			expect(parseEvent(envelope("approval.requested", payload)).ok).toBe(true);
		expect(
			parseEvent(
				envelope("approval.resolved", { ...asked, worktree: "/w/run/task" }),
			).ok,
		).toBe(false);
	});

	it("takes the files a handoff lists, or none, but not an empty path (ADR-133)", () => {
		const handoffId = crypto.randomUUID();
		for (const payload of [
			{ handoffId },
			{ handoffId, files: [] },
			{ handoffId, files: ["index.html", "design/index.html"] },
		])
			expect(parseEvent(envelope("handoff.created", payload)).ok).toBe(true);
		expect(
			parseEvent(envelope("handoff.created", { handoffId, files: [""] })).ok,
		).toBe(false);
	});

	it("takes a pair reviewer's feedback with its verdict (ADR-136)", () => {
		const done = { reviewerRoleId: "editor", decision: "revise" };
		for (const payload of [
			{ reviewerRoleId: "editor" },
			done,
			{ ...done, feedback: "Write gününüzü." },
		])
			expect(parseEvent(envelope("review.completed", payload)).ok).toBe(true);
		expect(
			parseEvent(envelope("review.completed", { ...done, feedback: 1 })).ok,
		).toBe(false);
	});

	it("takes a tool's progress with or without its total, and no message (ADR-067)", () => {
		const step = { capability: "mcp.tools@1", progress: 3 };
		for (const payload of [step, { ...step, total: 10 }])
			expect(parseEvent(envelope("agent.tool.progress", payload)).ok).toBe(
				true,
			);
		expect(
			parseEvent(envelope("agent.tool.progress", { ...step, message: "m" })).ok,
		).toBe(false);
	});

	it("takes an agent with or without its role tier, and only a known tier (ADR-077)", () => {
		const agent = { roleId: "qa", providerId: "groq", modelId: "m" };
		expect(parseEvent(envelope("agent.created", agent)).ok).toBe(true);
		expect(
			parseEvent(envelope("agent.created", { ...agent, tier: "coder" })).ok,
		).toBe(true);
		expect(
			parseEvent(envelope("agent.created", { ...agent, tier: "huge" })).ok,
		).toBe(false);
	});

	it("ends a model call with or without its usage, in whole tokens (ADR-090)", () => {
		expect(parseEvent(envelope("agent.thinking.ended", {})).ok).toBe(true);
		const usage = { prompt: 61_000, completion: 900 };
		expect(parseEvent(envelope("agent.thinking.ended", { usage })).ok).toBe(
			true,
		);
		for (const bad of [
			{ prompt: 1 },
			{ prompt: -1, completion: 0 },
			{ prompt: 1.5, completion: 0 },
		])
			expect(
				parseEvent(envelope("agent.thinking.ended", { usage: bad })).ok,
			).toBe(false);
	});

	it("caps message summaries at 80 characters", () => {
		const payload = (summary: string) => ({
			messageId: crypto.randomUUID(),
			from: "a",
			to: "human",
			kind: "handoff",
			summary,
		});
		expect(
			parseEvent(envelope("agent.message.sent", payload("x".repeat(80)))).ok,
		).toBe(true);
		expect(
			parseEvent(envelope("agent.message.sent", payload("x".repeat(81)))).ok,
		).toBe(false);
	});
});

describe("EVENT_TYPES", () => {
	it("covers the 44 types of the catalog in tab 07, all well formed", () => {
		expect(EVENT_TYPES).toHaveLength(44);
		for (const t of EVENT_TYPES) expect(EventTypeSchema.parse(t)).toBe(t);
	});
});
