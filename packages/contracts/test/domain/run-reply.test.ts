import { describe, expect, it } from "vitest";
import {
	DAEMON_METHODS,
	DAEMON_PROTOCOL_VERSION,
	RunReplyInputSchema,
	RunReplyOutputSchema,
} from "../../src/index.js";

describe("run.reply@1", () => {
	it("accepts one follow-up to an exact run and trims only its outer whitespace", () => {
		expect(
			RunReplyInputSchema.parse({
				runId: "previous",
				message: "  Merhaba\nNasilsin?  ",
			}),
		).toEqual({ runId: "previous", message: "Merhaba\nNasilsin?" });
		expect(RunReplyOutputSchema.parse({ runId: "next" })).toEqual({
			runId: "next",
		});
	});

	it("refuses empty, malformed and extra input instead of accepting arbitrary model history", () => {
		for (const input of [
			null,
			{},
			{ runId: "", message: "hi" },
			{ runId: "a", message: "  " },
			{ runId: "a", message: 1 },
			{ runId: "a", message: "hi", messages: [] },
		])
			expect(RunReplyInputSchema.safeParse(input).success).toBe(false);
		for (const output of [{}, { runId: "" }, { runId: "next", extra: true }])
			expect(RunReplyOutputSchema.safeParse(output).success).toBe(false);
	});

	it("keeps the explicit reply request under protocol37", () => {
		expect(DAEMON_METHODS.runReply).toBe("mete/run.reply");
		expect(DAEMON_PROTOCOL_VERSION).toBe(37);
	});
});
