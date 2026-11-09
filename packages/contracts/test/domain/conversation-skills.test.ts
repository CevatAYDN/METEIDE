import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import {
	ThreadContextReplyInputSchema,
	ThreadContextStartInputSchema,
} from "../../src/domain/conversation-context.js";
import {
	type ThreadSkillsReplyInput,
	ThreadSkillsReplyInputSchema,
	type ThreadSkillsStartInput,
	ThreadSkillsStartInputSchema,
} from "../../src/domain/conversation-skills.js";
import {
	ThreadReplyInputSchema,
	ThreadStartInputSchema,
} from "../../src/domain/conversation-thread.js";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const start: ThreadSkillsStartInput = { requestId: id(1), goal: "Review" };
const reply: ThreadSkillsReplyInput = {
	requestId: id(2),
	conversationId: id(3),
	expectedRunId: id(4),
	message: "Continue",
};
const version = {
	sourceId: "a".repeat(64),
	sha256: "b".repeat(64),
	revision: 7,
};
const auto = { mode: "auto", selected: [] };
const mutations = [
	[ThreadSkillsStartInputSchema, start],
	[ThreadSkillsReplyInputSchema, reply],
] as const;
const rejects = (schema: ZodType, input: unknown) =>
	expect(schema.safeParse(input).success).toBe(false);

describe("conversation.thread@3 skill selections", () => {
	it("creates independent default selection arrays for every new start", () => {
		const first = ThreadSkillsStartInputSchema.parse(start);
		const second = ThreadSkillsStartInputSchema.parse(start);
		expect(first.skills.selected).not.toBe(second.skills.selected);
		first.skills.selected.push(version);
		expect(second.skills.selected).toEqual([]);
		expect(ThreadSkillsStartInputSchema.parse(start).skills.selected).toEqual(
			[],
		);
	});

	it("defaults new starts but preserves absent reply policy and capabilities", () => {
		expect(ThreadSkillsStartInputSchema.parse(start)).toEqual({
			...start,
			capabilities: [],
			attachments: [],
			skills: auto,
		});
		const parsed = ThreadSkillsReplyInputSchema.parse(reply);
		expect(parsed).toEqual({ ...reply, attachments: [] });
		expect(Object.hasOwn(parsed, "skills")).toBe(false);
		expect(Object.hasOwn(parsed, "capabilities")).toBe(false);
		expect(
			ThreadSkillsReplyInputSchema.parse({ ...reply, skills: {} }),
		).toEqual({
			...reply,
			attachments: [],
			skills: auto,
		});
	});

	it("retains explicit manual, auto and off policies on both versioned inputs", () => {
		for (const skills of [
			{ mode: "manual", selected: [version] },
			{ mode: "auto", selected: [version] },
			{ mode: "off", selected: [] },
		]) {
			expect(ThreadSkillsStartInputSchema.parse({ ...start, skills })).toEqual({
				...start,
				capabilities: [],
				attachments: [],
				skills,
			});
			expect(ThreadSkillsReplyInputSchema.parse({ ...reply, skills })).toEqual({
				...reply,
				attachments: [],
				skills,
			});
		}
	});

	it("preserves exact ordered raw hashes and revisions without version substitution", () => {
		const other = {
			sourceId: "c".repeat(64),
			sha256: "d".repeat(64),
			revision: 11,
		};
		const skills = { mode: "manual", selected: [other, version] };
		for (const [schema, input] of mutations)
			expect(schema.parse({ ...input, skills }).skills).toEqual(skills);
		const selected = [1, 2, 3, 4, 5].map((n) => ({
			...version,
			sourceId: String(n).padStart(64, "0"),
		}));
		for (const [schema, input] of mutations) {
			expect(
				schema.parse({
					...input,
					skills: { mode: "manual", selected: selected.slice(0, 4) },
				}).skills?.selected,
			).toEqual(selected.slice(0, 4));
			rejects(schema, { ...input, skills: { mode: "manual", selected } });
		}
	});

	it("refuses duplicate sources, off selections and malformed version evidence", () => {
		for (const skills of [
			{ mode: "off", selected: [version] },
			{ mode: "always", selected: [] },
			{ selected: [version, { ...version, revision: 8 }] },
			{ selected: [version, { ...version, sha256: "c".repeat(64) }] },
			{ selected: [{ ...version, revision: 0 }] },
			{ selected: [{ ...version, revision: Number.MAX_SAFE_INTEGER + 1 }] },
			{ selected: [{ ...version, sourceId: "bad" }] },
			{ selected: [{ ...version, sha256: "A".repeat(64) }] },
		])
			for (const [schema, input] of mutations)
				rejects(schema, { ...input, skills });
	});

	it("refuses model origin, trust, content and native ownership claims", () => {
		for (const extra of [
			{ sessionId: id(5) },
			{ owner: { runId: id(4) } },
			{ workspace: "/private" },
			{ text: "skill body" },
			{ trusted: true },
			{ origin: "model" },
		])
			for (const [schema, input] of mutations)
				rejects(schema, { ...input, ...extra });
		for (const skills of [
			{ ...auto, origin: "model" },
			{ ...auto, trusted: true },
			{ selected: [{ ...version, origin: "model" }] },
			{ selected: [{ ...version, trusted: true }] },
			{ selected: [{ ...version, text: "instructions" }] },
		])
			for (const [schema, input] of mutations)
				rejects(schema, { ...input, skills });
	});

	it("preserves editor attachments, preference, capabilities and exact head fields", () => {
		const attachment = {
			path: "src/main.ts",
			content: "\ufeffconst n = 1;\r\n",
			modified: true,
			sha256: "e".repeat(64),
			range: {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 5 },
			},
		};
		const additions = {
			attachments: [attachment],
			capabilities: ["web.fetch@1", "mcp.tools@1"],
			skills: { mode: "manual", selected: [version] },
		};
		const fullStart = {
			...start,
			...additions,
			prefer: { providerId: "provider-a", modelId: "model-a" },
		};
		expect(ThreadSkillsStartInputSchema.parse(fullStart)).toEqual(fullStart);
		const fullReply = { ...reply, ...additions };
		expect(ThreadSkillsReplyInputSchema.parse(fullReply)).toEqual(fullReply);
		for (const field of ["requestId", "conversationId", "expectedRunId"])
			rejects(ThreadSkillsReplyInputSchema, { ...fullReply, [field]: "bad" });
		rejects(ThreadSkillsStartInputSchema, {
			...fullStart,
			requestId: undefined,
		});
		rejects(ThreadSkillsReplyInputSchema, {
			...fullReply,
			expectedRunId: undefined,
		});
		rejects(ThreadSkillsReplyInputSchema, {
			...fullReply,
			prefer: fullStart.prefer,
		});
		for (const [schema, input] of mutations) {
			rejects(schema, { ...input, capabilities: ["fs.read@1"] });
			rejects(schema, {
				...input,
				capabilities: ["web.fetch@1", "web.fetch@1"],
			});
			rejects(schema, {
				...input,
				attachments: [{ ...attachment, trusted: true }],
			});
		}
	});

	it("leaves @1 and @2 strict and preserves their old normalization/defaults", () => {
		expect(
			ThreadStartInputSchema.parse({ ...start, goal: " Review " }),
		).toEqual({
			...start,
			capabilities: [],
		});
		expect(
			ThreadReplyInputSchema.parse({ ...reply, message: " Continue " }),
		).toEqual(reply);
		expect(ThreadContextStartInputSchema.parse(start)).toEqual({
			...start,
			capabilities: [],
			attachments: [],
		});
		expect(ThreadContextReplyInputSchema.parse(reply)).toEqual({
			...reply,
			attachments: [],
		});
		for (const [schema, input] of [
			[ThreadStartInputSchema, start],
			[ThreadReplyInputSchema, reply],
			[ThreadContextStartInputSchema, start],
			[ThreadContextReplyInputSchema, reply],
		] as const)
			rejects(schema, { ...input, skills: auto });
	});
});
