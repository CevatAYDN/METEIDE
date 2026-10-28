import { describe, expect, it } from "vitest";
import { runsSkip } from "../src/application/endpoint-test.js";
import type {
	DaemonFailure,
	EndpointModels,
	EndpointTest,
} from "../src/domain/status-service.js";
import { EndpointTests } from "../src/infrastructure/endpoint-tests.js";

// A custom endpoint's Test from the card (ADR-087): its models listed on request, and one probe per
// model the user picked; a refused request means METE has not loaded the endpoint.

type Answer<T> = { ok: true; value: T } | { ok: false; error: DaemonFailure };

const model = (id: string) => ({
	id,
	providerId: "custom:my-lab",
	family: "",
	contextWindow: 0,
	toolCalling: "unknown" as const,
	vision: "unknown" as const,
	free: true,
	deprecated: false,
});

const setup = (
	listed: Answer<EndpointModels>,
	probed: Answer<EndpointTest> = { ok: true, value: { results: [] } },
) => {
	const asked: string[] = [];
	const probes: [string, readonly string[]][] = [];
	const tests = new EndpointTests({
		models: async (id) => {
			asked.push(id);
			return listed;
		},
		probe: async (id, models) => {
			probes.push([id, models]);
			return probed;
		},
		onChange: () => {},
	});
	return { tests, asked, probes };
};

describe("a custom endpoint's Test from the card", () => {
	it("marks a model runs skip: no context window, or neither free nor priced (ADR-154)", () => {
		const rowed = { ...model("r"), contextWindow: 128_000 };
		expect(runsSkip(model("ids-only"))).toBe(true);
		expect(runsSkip(rowed)).toBe(false);
		expect(runsSkip({ ...rowed, free: false })).toBe(true);
		expect(
			runsSkip({ ...rowed, free: false, price: { input: 1, output: 2 } }),
		).toBe(false);
	});

	it("lists the models on request, then probes the picked ones in order", async () => {
		const results = [
			{ modelId: "b", ok: true as const, ms: 7 },
			{
				modelId: "a",
				ok: false as const,
				failed: { code: "bad_request" as const, message: "no such model" },
			},
		];
		const { tests, asked, probes } = setup(
			{ ok: true, value: { models: [model("a"), model("b")] } },
			{ ok: true, value: { results } },
		);
		expect(tests.stateOf("my-lab")).toEqual({ kind: "idle" });
		await tests.list("my-lab");
		expect(asked).toEqual(["custom:my-lab"]);
		expect(tests.stateOf("my-lab")).toEqual({
			kind: "listed",
			models: ["a", "b"],
			// An ids-only listing: no context window, so runs skip both (ADR-154).
			skipped: ["a", "b"],
			picked: [],
			testing: false,
		});
		tests.pick("my-lab", "b", true);
		tests.pick("my-lab", "a", true);
		await tests.probe("my-lab");
		expect(probes).toEqual([["custom:my-lab", ["b", "a"]]]);
		expect(tests.stateOf("my-lab")).toEqual({
			kind: "listed",
			models: ["a", "b"],
			skipped: ["a", "b"],
			picked: ["b", "a"],
			testing: false,
			results,
		});
	});

	it("says the endpoint is not loaded when the daemon refuses, and why a listing failed", async () => {
		const gone = setup({
			ok: false,
			error: { code: "refused", detail: "no custom:my-lab" },
		});
		await gone.tests.list("my-lab");
		expect(gone.tests.stateOf("my-lab")).toEqual({ kind: "not_loaded" });
		const failed = setup({
			ok: true,
			value: {
				failed: { code: "unauthorized", message: "bad key", status: 401 },
			},
		});
		await failed.tests.list("my-lab");
		const state = failed.tests.stateOf("my-lab");
		expect(state.kind === "failed" && state.text).toBe(
			"Listing the models failed: unauthorized 401 bad key",
		);
	});

	it("keeps the list when a probe cannot be asked, and says why", async () => {
		const { tests } = setup(
			{ ok: true, value: { models: [model("a")] } },
			{ ok: false, error: { code: "stopped", detail: "exit code 1" } },
		);
		await tests.list("my-lab");
		tests.pick("my-lab", "a", true);
		await tests.probe("my-lab");
		const state = tests.stateOf("my-lab");
		expect(state.kind === "listed" && state.testing).toBe(false);
		expect(state.kind === "listed" && state.problem).toContain("exit code 1");
	});

	it("asks nothing for a slug that is not one or with no model picked, and forgets all on reset", async () => {
		const { tests, asked, probes } = setup({
			ok: true,
			value: { models: [model("a")] },
		});
		await tests.list("My Lab");
		await tests.list("my-lab");
		await tests.probe("my-lab");
		expect(asked).toEqual(["custom:my-lab"]);
		expect(probes).toEqual([]);
		tests.reset();
		expect(tests.stateOf("my-lab")).toEqual({ kind: "idle" });
	});
});
