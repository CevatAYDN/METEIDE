import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import {
	ThreadSkillsReplyInputSchema as replyInput,
	ThreadSkillsStartInputSchema as startInput,
} from "../../src/domain/conversation-skills.js";
import { ThreadStartedSchema } from "../../src/domain/conversation-thread.js";
import { DaemonRunStartResultSchema } from "../../src/domain/daemon.js";
import {
	DaemonSkillsRuntimeParamsSchema as catalogParams,
	DaemonSkillsRuntimeResultSchema as catalogResult,
	DaemonRunSkillsReadParamsSchema as readParams,
	DaemonRunSkillsReadResultSchema as readResult,
	DaemonThreadSkillsReplyParamsSchema as replyParams,
	DaemonThreadSkillsReplyResultSchema as replyResult,
	DaemonRunSkillsStartParamsSchema as runParams,
	DaemonRunSkillsStartResultSchema as runResult,
	DaemonThreadSkillsStartParamsSchema as startParams,
	DaemonThreadSkillsStartResultSchema as startResult,
} from "../../src/domain/daemon-skill-runtime.js";
import { skillLoadedMetadata } from "../../src/domain/run-skills.js";
import { RunSkillsStartInputSchema as runInput } from "../../src/domain/run-skills-input.js";
import type { SkillSnapshot } from "../../src/domain/skill-runtime.js";

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sessionId = id(1);
const start = { requestId: id(2), goal: "Review" };
const reply = {
	requestId: id(3),
	conversationId: id(4),
	expectedRunId: id(5),
	message: "Next",
};
const sends = [
	[startParams, startInput, start],
	[replyParams, replyInput, reply],
	[runParams, runInput, { goal: "Review" }],
] as const;
const version = {
	sourceId: "a".repeat(64),
	sha256: "b".repeat(64),
	revision: 1,
};
const owner = { runId: id(5), contextId: id(6) };
const snapshot: SkillSnapshot = {
	receiptId: id(7),
	owner,
	inspection: {
		source: {
			sourceId: version.sourceId,
			scope: "workspace",
			path: "review/SKILL.md",
		},
		text: "Retained body",
		metadata: { name: "review", description: "Review" },
		sha256: version.sha256,
	},
	revision: 1,
	origin: "model",
	loadedAt: "2026-11-09T00:00:00Z",
	payloadSha256: "c".repeat(64),
};
const context = {
	owner,
	roleId: "assistant",
	policy: { mode: "auto", selected: [] },
	status: "loaded",
	loaded: [skillLoadedMetadata(snapshot)],
};
const detail = {
	kind: "context",
	runId: owner.runId,
	context,
	snapshots: [snapshot],
};
const summary = {
	kind: "summary",
	runId: owner.runId,
	policy: { mode: "auto", roles: [] },
	contexts: [context],
};
const accepts = (schema: ZodType, input: unknown) =>
	expect(schema.parse(input)).toEqual(input);
const rejects = (schema: ZodType, input: unknown) =>
	expect(schema.safeParse(input).success).toBe(false);

describe("daemon S2 transport contracts", () => {
	it("requires session UUIDs only at send boundaries, never capability authority", () => {
		for (const [schema, capability, input] of sends) {
			const request = { ...input, sessionId };
			expect(schema.parse(request)).toMatchObject(request);
			rejects(capability, request);
			for (const patch of [
				{ sessionId: undefined },
				{ sessionId: "bad" },
				{ sessionId: null },
				{ body: "secret" },
				{ trusted: true },
				{ owner },
			])
				rejects(schema, { ...request, ...patch });
		}
	});

	it("preserves start defaults, absent reply policy and exact editor attachments", () => {
		expect(startParams.parse({ ...start, sessionId }).skills).toEqual({
			mode: "auto",
			selected: [],
		});
		expect(replyParams.parse({ ...reply, sessionId })).not.toHaveProperty(
			"skills",
		);
		const attachment = {
			path: "src/a.ts",
			content: "\ufeffa\r\n",
			modified: true,
			sha256: "d".repeat(64),
		};
		for (const [schema, input] of [
			[startParams, start],
			[replyParams, reply],
		] as const) {
			const request = { ...input, sessionId, attachments: [attachment] };
			expect(schema.parse(request).attachments).toEqual([attachment]);
			rejects(schema, {
				...request,
				attachments: [{ ...attachment, trusted: true }],
			});
			rejects(schema, { ...request, skills: { selected: [version, version] } });
			rejects(schema, {
				...request,
				skills: { mode: "off", selected: [version] },
			});
		}
	});

	it("retains run goal/continue, router, role and policy refinements", () => {
		accepts(runParams, {
			sessionId,
			continue: true,
			priority: 1,
			skills: { mode: "auto", roles: [] },
		});
		rejects(runParams, { sessionId });
		const role = { roleId: "writer", selected: [version] };
		const skills = { mode: "manual", roles: [role] };
		const request = {
			sessionId,
			goal: "Review",
			templateId: "review-team",
			priority: 2,
			skills,
		};
		accepts(runParams, request);
		for (const patch of [
			{ templateId: undefined },
			{ templateId: null },
			{ skills: { ...skills, roles: [role, role] } },
			{ skills: { ...skills, mode: "off" } },
		])
			rejects(runParams, { ...request, ...patch });
	});

	it("reuses bare mutation successes and leaves engine failures to JSON-RPC", () => {
		expect(startResult).toBe(ThreadStartedSchema);
		expect(replyResult).toBe(ThreadStartedSchema);
		expect(runResult).toBe(DaemonRunStartResultSchema);
		for (const schema of [startResult, replyResult, runResult])
			rejects(schema, { ok: false, error: { code: "bad_input" } });
	});

	it("distinguishes session-bound ready-empty, unavailable and typed failures", () => {
		accepts(catalogParams, {});
		rejects(catalogParams, { sessionId });
		for (const catalog of [
			{ status: "ready", entries: [], diagnostics: [] },
			{
				status: "unavailable",
				entries: [],
				diagnostics: [{ code: "unavailable" }],
			},
		]) {
			const value = { sessionId, catalog };
			accepts(catalogResult, { ok: true, value });
			rejects(catalogResult, {
				ok: true,
				value: { ...value, sessionId: "bad" },
			});
			rejects(catalogResult, {
				ok: true,
				value: { ...value, sessionId: undefined },
			});
			rejects(catalogResult, { ok: true, value: { ...value, body: "secret" } });
		}
	});

	it("preserves safe precise catalog/run/context errors without mixed envelopes", () => {
		for (const schema of [catalogResult, readResult])
			for (const code of [
				"unavailable",
				"not_found",
				"revoked",
				"integrity_failed",
			]) {
				const error = { code, sourceId: version.sourceId, location: "source" };
				accepts(schema, { ok: false, error });
				rejects(schema, { ok: false, error, value: null });
				rejects(schema, { ok: false, error: { ...error, message: "secret" } });
				rejects(schema, { ok: true, value: null });
			}
	});

	it("returns bodies only for an exact context and enforces metadata correspondence", () => {
		accepts(readParams, { runId: owner.runId });
		accepts(readParams, owner);
		for (const extra of [{ sessionId }, { body: "secret" }, { trusted: true }])
			rejects(readParams, { ...owner, ...extra });
		for (const value of [
			summary,
			detail,
			{ kind: "legacy", runId: owner.runId },
		])
			accepts(readResult, { ok: true, value });
		for (const value of [
			{ ...summary, snapshots: [snapshot] },
			{ ...detail, sessionId },
			{ ...detail, trusted: true },
			{ ...detail, snapshots: [] },
			{
				...detail,
				snapshots: [{ ...snapshot, payloadSha256: "d".repeat(64) }],
			},
			{
				...detail,
				snapshots: [{ ...snapshot, owner: { ...owner, contextId: id(9) } }],
			},
		])
			rejects(readResult, { ok: true, value });
	});
});
