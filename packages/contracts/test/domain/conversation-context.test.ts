import { describe, expect, it } from "vitest";
import {
	ThreadReplyInputSchema,
	ThreadStartInputSchema,
} from "../../src/domain/conversation-thread.js";
import {
	ContextAttachmentsSchema,
	ContextDraftSchema,
	ContextRangeSchema,
	ContextSnapshotSchema,
	FsContextInputSchema,
	FsContextOutputSchema,
	ThreadContextReadResultSchema,
	ThreadContextReplyInputSchema,
	ThreadContextStartInputSchema,
} from "../../src/thread-contracts.js";

const draft = {
	path: "src/main.ts",
	content: "const n = 1;\n",
	modified: true,
};
const snapshot = { ...draft, sha256: "a".repeat(64) };
const start = { requestId: crypto.randomUUID(), goal: "Review this" };
const reply = {
	requestId: crypto.randomUUID(),
	conversationId: crypto.randomUUID(),
	expectedRunId: crypto.randomUUID(),
	message: "Review this too",
};

describe("explicit editor context boundaries", () => {
	it("keeps the exact editor text and requires explicit source provenance", () => {
		expect(ContextDraftSchema.parse(draft)).toEqual(draft);
		expect(
			ContextDraftSchema.parse({ ...draft, content: "\ufeffvalid text" })
				.content,
		).toBe("\ufeffvalid text");
		for (const bad of [
			{ ...draft, modified: undefined },
			{ ...draft, content: "" },
			{ ...draft, content: "a\0b" },
			{ ...draft, content: "\ud800" },
			{ ...draft, path: "" },
			{ ...draft, path: "a\nb" },
			{ ...draft, path: "a".repeat(4097) },
			{ ...draft, trusted: true },
		])
			expect(ContextDraftSchema.safeParse(bad).success).toBe(false);
	});

	it("enforces UTF-8 bytes rather than JS string length without truncation", () => {
		for (const content of ["a".repeat(32768), "\u00e9".repeat(16384)])
			expect(ContextDraftSchema.parse({ ...draft, content }).content).toBe(
				content,
			);
		for (const content of ["a".repeat(32769), "\u00e9".repeat(16385)])
			expect(ContextDraftSchema.safeParse({ ...draft, content }).success).toBe(
				false,
			);
	});

	it("accepts only ordered nonempty UTF-16 ranges with safe integer coordinates", () => {
		const range = {
			start: { line: 0, character: 2 },
			end: { line: 1, character: 0 },
		};
		expect(ContextRangeSchema.parse(range)).toEqual(range);
		for (const bad of [
			{ start: range.start, end: range.start },
			{ start: range.end, end: range.start },
			{ ...range, start: { line: -1, character: 0 } },
			{ ...range, end: { line: 1.5, character: 0 } },
			{ ...range, end: { line: Number.MAX_SAFE_INTEGER + 1, character: 0 } },
		])
			expect(ContextRangeSchema.safeParse(bad).success).toBe(false);
	});

	it("bounds each list and its combined bytes", () => {
		expect(ContextAttachmentsSchema.parse([])).toEqual([]);
		expect(
			ContextAttachmentsSchema.parse(Array(4).fill(snapshot)),
		).toHaveLength(4);
		expect(
			ContextAttachmentsSchema.safeParse(Array(5).fill(snapshot)).success,
		).toBe(false);
		const large = { ...snapshot, content: "a".repeat(32768) };
		expect(ContextAttachmentsSchema.safeParse([large, large]).success).toBe(
			true,
		);
		expect(
			ContextAttachmentsSchema.safeParse([large, large, snapshot]).success,
		).toBe(false);
		expect(
			ContextSnapshotSchema.safeParse({ ...snapshot, sha256: "not-a-hash" })
				.success,
		).toBe(false);
	});

	it("keeps @1 strict while @2 accepts context and defaults to no attachments", () => {
		expect(ThreadContextStartInputSchema.parse(start).attachments).toEqual([]);
		expect(ThreadContextReplyInputSchema.parse(reply).attachments).toEqual([]);
		expect(
			ThreadContextStartInputSchema.parse({ ...start, attachments: [snapshot] })
				.attachments,
		).toEqual([snapshot]);
		expect(
			ThreadContextReplyInputSchema.parse({ ...reply, attachments: [snapshot] })
				.attachments,
		).toEqual([snapshot]);
		expect(
			ThreadStartInputSchema.safeParse({ ...start, attachments: [] }).success,
		).toBe(false);
		expect(
			ThreadReplyInputSchema.safeParse({ ...reply, attachments: [] }).success,
		).toBe(false);
	});

	it("exposes only the canonical path from file inspection and strict turn context", () => {
		expect(FsContextInputSchema.parse({ path: draft.path })).toEqual({
			path: draft.path,
		});
		expect(FsContextOutputSchema.parse({ path: draft.path })).toEqual({
			path: draft.path,
		});
		expect(
			FsContextOutputSchema.safeParse({ path: draft.path, content: "secret" })
				.success,
		).toBe(false);
		for (const path of [
			"/tmp/file",
			"../file",
			"src/./file",
			"src//file",
			"C:\\file",
		])
			expect(FsContextOutputSchema.safeParse({ path }).success).toBe(false);
		const result = { runId: reply.expectedRunId, attachments: [snapshot] };
		expect(ThreadContextReadResultSchema.parse(result)).toEqual(result);
		expect(
			ThreadContextReadResultSchema.safeParse({ ...result, runId: "x" })
				.success,
		).toBe(false);
	});
});
