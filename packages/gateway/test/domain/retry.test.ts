import type {
	ChatRequest,
	ProviderError,
	QuotaObservation,
} from "@mete/contracts";
import { describe, expect, it } from "vitest";
import { afterFailure, estimateTokens } from "../../src/domain/retry.js";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const limited: ProviderError = {
	code: "rate_limited",
	message: "429",
	status: 429,
};
const server: ProviderError = { code: "server", message: "502", status: 502 };
const closes = (inMs: number): QuotaObservation => ({
	unit: "requests_per_minute",
	exhausted: true,
	resetsAt: new Date(NOW + inMs).toISOString(),
});

describe("afterFailure", () => {
	it("backs off 2 then 8 seconds and moves on at the third failure", () => {
		expect(afterFailure(limited, 1, [], NOW)).toEqual({
			kind: "retry",
			waitMs: 2_000,
		});
		expect(afterFailure(server, 2, [], NOW)).toEqual({
			kind: "retry",
			waitMs: 8_000,
		});
		expect(afterFailure(limited, 3, [], NOW)).toEqual({ kind: "next" });
	});

	it("waits for the earliest reset when it comes within 90 seconds", () => {
		const obs = [closes(40_000), closes(15_000)];
		expect(afterFailure(limited, 1, obs, NOW)).toEqual({
			kind: "retry",
			waitMs: 15_000,
		});
		expect(afterFailure(limited, 2, [closes(-5_000)], NOW)).toEqual({
			kind: "retry",
			waitMs: 0,
		});
	});

	it("backs off instead when the reset is 90 seconds or more away", () => {
		expect(afterFailure(limited, 1, [closes(90_000)], NOW)).toEqual({
			kind: "retry",
			waitMs: 2_000,
		});
	});

	it("moves on at once for other errors and ends an aborted call", () => {
		for (const code of ["unauthorized", "bad_request", "network"] as const)
			expect(afterFailure({ code, message: code }, 1, [], NOW)).toEqual({
				kind: "next",
			});
		expect(afterFailure({ code: "aborted", message: "x" }, 1, [], NOW)).toEqual(
			{ kind: "end" },
		);
	});
});

describe("estimateTokens", () => {
	it("counts message text, tool calls and tool specs at 4 characters a token, plus maxTokens", () => {
		const tools = [{ name: "t", description: "d", parameters: {} }];
		const toolCalls = [{ id: "c", name: "t", args: { a: 1 } }];
		const chars =
			"abcd".length +
			"efg".length +
			"hi".length +
			JSON.stringify(toolCalls).length +
			"result".length +
			JSON.stringify(tools).length;
		const req: Pick<ChatRequest, "messages" | "tools"> = {
			messages: [
				{ role: "system", content: "abcd" },
				{
					role: "user",
					content: [
						{ type: "text", text: "efg" },
						{ type: "image", mediaType: "image/png", data: "AAAA" },
					],
				},
				{ role: "assistant", content: "hi", toolCalls },
				{ role: "tool", toolCallId: "c", content: "result" },
			],
			tools,
		};
		expect(estimateTokens(req)).toBe(Math.ceil(chars / 4));
		expect(estimateTokens({ ...req, maxTokens: 100 })).toBe(
			Math.ceil(chars / 4) + 100,
		);
	});
});
