import { ok } from "@mete/contracts";
import type { AgentCard } from "@mete/ui-studio";
import { describe, expect, it, vi } from "vitest";
import { createModelSession } from "../src/application/model-session.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";

// The Team panel's model choice (ADR-122): the model picker's facts and states follow the
// candidates, asked again only when new candidates came (ADR-161).

describe("the model session's picker facts", () => {
	it("asks once for the candidates' facts and the states, and again only for a new member", async () => {
		const models = vi.fn(async () => ok({ models: [] }));
		const daemon = {
			chain: async () => ok({ models: [{ providerId: "groq", modelId: "m" }] }),
			models,
			quota: async () =>
				ok({ providers: [{ id: "groq", state: "ready" }], units: [] }),
		} as unknown as MeteDaemonService;
		const session = createModelSession({
			daemon,
			onChange: () => {},
			warn: () => {},
		});
		session.show("/w", crypto.randomUUID());
		const lead = { roleId: "lead", tier: "coder" } as AgentCard;
		await session.askChains([lead]);
		expect(models).toHaveBeenCalledTimes(1);
		expect(session.picker?.states).toEqual([{ id: "groq", state: "ready" }]);
		await session.askChains([lead]);
		expect(models).toHaveBeenCalledTimes(1);
		await session.askChains([
			lead,
			{ roleId: "qa", tier: "fast" } as AgentCard,
		]);
		expect(models).toHaveBeenCalledTimes(2);
	});
});
