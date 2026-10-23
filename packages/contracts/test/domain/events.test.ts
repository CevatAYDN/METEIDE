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
	it("covers the 43 types of the catalog in tab 07, all well formed", () => {
		expect(EVENT_TYPES).toHaveLength(43);
		for (const t of EVENT_TYPES) expect(EventTypeSchema.parse(t)).toBe(t);
	});
});
