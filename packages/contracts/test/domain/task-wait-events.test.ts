import { describe, expect, it } from "vitest";
import { parseEvent } from "../../src/domain/events.js";

const event = (type: string, payload: unknown) => ({
	id: crypto.randomUUID(),
	ts: new Date(0).toISOString(),
	schema: 1,
	workspaceId: crypto.randomUUID(),
	runId: crypto.randomUUID(),
	taskId: crypto.randomUUID(),
	agentId: crypto.randomUUID(),
	source: "core-engine",
	type,
	payload,
});

describe("task wait events", () => {
	it.each(["task.waiting", "task.wait.resolved"])(
		"%s identifies an exact pending decision without disclosing arguments",
		(type) => {
			for (const kind of [
				"policy",
				"approval",
				"clarification",
				"blocked",
				"merge",
			])
				expect(
					parseEvent(event(type, { kind, requestId: crypto.randomUUID() })).ok,
				).toBe(true);
			expect(
				parseEvent(event(type, { kind: "policy", requestId: "bad" })).ok,
			).toBe(false);
			expect(
				parseEvent(
					event(type, {
						kind: "policy",
						requestId: crypto.randomUUID(),
						command: "secret",
					}),
				).ok,
			).toBe(false);
		},
	);
});
