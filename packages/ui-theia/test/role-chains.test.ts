import { ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import {
	chainsOfRoles,
	needsFor,
	needsOfRoles,
} from "../src/application/role-chains.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";

const TEAM = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: duo, name: Duo, version: 1.0.0 }
pattern: pipeline
roles:
  - { id: finder, name: Finder, goal: Find, tier: reasoning, needs: [tool_calling], capabilities: [fs.read@1] }
  - { id: writer, name: Writer, goal: Write, tier: fast, capabilities: [] }
tasks:
  - { id: find, role: finder, title: Find }
`;

describe("role chains (ADR-122)", () => {
	it("reads each role's needs from the team file", () => {
		expect(needsOfRoles(TEAM)).toEqual({
			finder: ["tool_calling"],
			writer: [],
		});
	});

	it("asks every role's chain with the needs that role names", async () => {
		const chain = vi.fn(async (_dir: string, tier: string) =>
			ok({ models: [{ providerId: "p", modelId: tier }] }),
		);
		const ctx = {
			daemon: { chain } as unknown as MeteDaemonService,
			dir: "/w",
			cache: new Map<string, readonly string[]>(),
		};
		const chains = await chainsOfRoles(ctx, TEAM);
		expect(chains).toEqual({ finder: ["p/reasoning"], writer: ["p/fast"] });
		expect(chain).toHaveBeenCalledWith("/w", "reasoning", ["tool_calling"]);
		expect(chain).toHaveBeenCalledWith("/w", "fast", []);
	});

	it("asks the single agent's chain for tool calling, and a member's for its role's needs", () => {
		expect(needsFor(null, {}, "assistant")).toEqual(["tool_calling"]);
		expect(needsFor("duo", { finder: ["tool_calling"] }, "finder")).toEqual([
			"tool_calling",
		]);
		expect(needsFor("duo", {}, "gone")).toEqual([]);
	});
});
