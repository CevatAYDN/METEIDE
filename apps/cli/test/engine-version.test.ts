import { ok, type TeamEngineAdapter } from "@mete/contracts";
import { createCapabilityRegistry } from "@mete/kernel";
import { describe, expect, it } from "vitest";
import { statusCommand } from "../src/application/commands.js";
import { admitManagement } from "../src/application/daemon-quiesce.js";
import { type App, engineOf } from "../src/infrastructure/app.js";
import { recordingIo } from "./helpers.js";

const engine: TeamEngineAdapter = {
	start: async () => ok({ runId: crypto.randomUUID() }),
	pause: async () => ok(undefined),
	resume: async () => ok(undefined),
	cancel: async () => ok(undefined),
	approve: async () => ok(undefined),
	status: () => ok([]),
};
const setup = () => {
	const registry = createCapabilityRegistry(() => []);
	const app = { registry, modules: [], inactive: [] } as unknown as App;
	const provide = (ref: "team.engine@2" | "team.engine@3") =>
		registry.provide(ref, {
			id: "test-engine",
			trust: "core",
			features: [],
			impl: engine,
		});
	return { app, provide };
};

describe("CLI native engine version (ADR-187)", () => {
	it("uses @3 with the existing status method shape", async () => {
		const { app, provide } = setup();
		provide("team.engine@3");
		expect(engineOf(app)).toEqual(ok(engine));
		const output = recordingIo();
		expect(await statusCommand(app, output.io, undefined, true)).toBe(0);
		expect(output.out).toEqual(["[]"]);
	});

	it("refuses an @2-only engine instead of downgrading", async () => {
		const { app, provide } = setup();
		provide("team.engine@2");
		expect(engineOf(app)).toEqual({
			ok: false,
			error: ["core-engine is not active."],
		});
		const output = recordingIo();
		expect(await statusCommand(app, output.io)).toBe(1);
		expect(output.out).toEqual([]);
		expect(output.err).toContain("core-engine is not active.");
	});

	it("refuses restart when @3 exists without a quiesce port", async () => {
		const { app, provide } = setup();
		provide("team.engine@3");
		await expect(admitManagement(app)).rejects.toMatchObject({
			data: { code: "not_supported" },
		});
	});

	it("permits idle management when no native engine is active", async () => {
		const { app } = setup();
		await expect(admitManagement(app)).resolves.toBeUndefined();
	});
});
