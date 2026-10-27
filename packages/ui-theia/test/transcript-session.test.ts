import type { MeteEvent, Transcript } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranscriptSession } from "../src/application/transcript-session.js";
import { TRANSCRIPT_REFETCH_MS } from "../src/defaults.js";

const RUN = crypto.randomUUID();

const event = (type: string, runId = RUN): MeteEvent =>
	({
		id: crypto.randomUUID(),
		ts: "2026-10-27T10:00:00.000Z",
		schema: 1,
		workspaceId: crypto.randomUUID(),
		runId,
		source: "core-engine",
		type,
		payload: {},
	}) as MeteEvent;

describe("the Team panel's transcript (ADR-125)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("asks when a run is shown, then once for a burst of its step events", async () => {
		const transcript: Transcript = { runId: RUN, conversations: [] };
		const fetch = vi.fn(async () => ({ ok: true as const, value: transcript }));
		const session = createTranscriptSession({ fetch, onChange: () => {} });
		session.show("/work", RUN);
		await vi.advanceTimersByTimeAsync(0);
		for (const type of [
			"agent.thinking.ended",
			"agent.tool.completed",
			"task.status.changed",
			"agent.thinking.started",
		])
			session.onEvent(event(type));
		session.onEvent(event("agent.tool.completed", crypto.randomUUID()));
		await vi.advanceTimersByTimeAsync(TRANSCRIPT_REFETCH_MS);
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(session.state.transcript).toBe(transcript);
		session.dispose();
	});
});
