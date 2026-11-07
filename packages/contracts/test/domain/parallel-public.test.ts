import { describe, expect, it } from "vitest";
import {
	PolicyPendingInputSchema,
	TaskPendingInputSchema,
	ToolIsolationSchema,
} from "../../src/index.js";

describe("parallel-control public contracts", () => {
	it("keeps the approved schemas available through the package boundary", () => {
		const runId = crypto.randomUUID();
		expect(TaskPendingInputSchema.parse({ runId })).toEqual({ runId });
		expect(
			PolicyPendingInputSchema.safeParse({
				runId,
				agentId: crypto.randomUUID(),
			}).success,
		).toBe(true);
		expect(ToolIsolationSchema.parse({ scope: "workspace" })).toEqual({
			scope: "workspace",
		});
	});
});
