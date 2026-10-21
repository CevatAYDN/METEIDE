import { describe, expect, it } from "vitest";
import { toProviderError } from "../../src/infrastructure/sdk-chat.js";

const live = new AbortController().signal;

describe("toProviderError", () => {
	it("reads an error object a provider sends inside the stream", () => {
		expect(
			toProviderError({ message: "Rate limit exceeded", code: 429 }, live),
		).toEqual({ code: "rate_limited", message: "Rate limit exceeded" });
		expect(
			toProviderError({ message: "upstream down", code: 502 }, live),
		).toEqual({ code: "server", message: "upstream down" });
		expect(
			toProviderError(
				{ message: "model overloaded", code: "server_error" },
				live,
			),
		).toEqual({ code: "server", message: "model overloaded" });
	});

	it("keeps network for a thrown error and anything unreadable", () => {
		expect(toProviderError(new TypeError("fetch failed"), live)).toEqual({
			code: "network",
			message: "fetch failed",
		});
		expect(toProviderError(42, live)).toEqual({
			code: "network",
			message: "42",
		});
	});
});
