import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
	createModelCallLog,
	MODEL_CALL_MIGRATIONS,
	type ModelCall,
} from "../../src/infrastructure/model-calls.js";

const call = (ts: string): ModelCall => ({
	ts,
	runId: "run",
	providerId: "p",
	modelId: "m",
	tier: "coder",
	request: { messages: [{ role: "user", content: "hi" }], tools: [] },
	response: { text: "ok", toolCalls: [] },
	promptTokens: 3,
	completionTokens: 2,
	latencyMs: 40,
	outcome: "stop",
});

const open = () => {
	const db = new Database(":memory:");
	for (const m of MODEL_CALL_MIGRATIONS) db.exec(m.sql);
	let n = 0;
	return { db, log: createModelCallLog(db, () => `id${++n}`) };
};

describe("model_calls log", () => {
	it("writes one row per call with JSON request and response", () => {
		const { db, log } = open();
		log.write(call("2026-10-21T12:00:00.000Z"));
		expect(db.prepare("SELECT * FROM model_calls").all()).toEqual([
			{
				id: "id1",
				ts: "2026-10-21T12:00:00.000Z",
				run_id: "run",
				provider_id: "p",
				model_id: "m",
				tier: "coder",
				request: JSON.stringify(call("").request),
				response: '{"text":"ok","toolCalls":[]}',
				prompt_tokens: 3,
				completion_tokens: 2,
				latency_ms: 40,
				outcome: "stop",
			},
		]);
	});

	it("prunes rows written before the cut-off", () => {
		const { db, log } = open();
		log.write(call("2026-07-01T00:00:00.000Z"));
		log.write(call("2026-10-21T00:00:00.000Z"));
		log.prune("2026-07-23T00:00:00.000Z");
		expect(db.prepare("SELECT id FROM model_calls").all()).toEqual([
			{ id: "id2" },
		]);
	});
});
