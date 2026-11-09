import { randomUUID } from "node:crypto";
import {
	DAEMON_METHODS,
	type DaemonThreadSkillsStartParams,
	err,
	ok,
} from "@mete/contracts";
import { expect, it, vi } from "vitest";
import type { SkillTransport } from "../src/infrastructure/skill-requests.js";
import { skillRuntimeRequests } from "../src/infrastructure/skill-runtime-requests.js";

const sessionId = randomUUID();
const started = { conversationId: randomUUID(), runId: randomUUID() };
const input: DaemonThreadSkillsStartParams = {
	sessionId,
	requestId: randomUUID(),
	goal: "Review",
	skills: {
		mode: "manual",
		selected: [
			{ sourceId: "a".repeat(64), sha256: "b".repeat(64), revision: 1 },
		],
	},
};
const setup = () => {
	let current = true;
	let response: unknown = ok({
		sessionId,
		catalog: { status: "ready", entries: [], diagnostics: [] },
	});
	let beforeReply = () => {};
	const sent: { method: string; input: object }[] = [];
	const transport: SkillTransport = {
		identity: {},
		current: () => current,
		ended: () => !current,
		retire: vi.fn(async () => {}),
		send: async (method, params, parse) => {
			sent.push({ method, input: params });
			beforeReply();
			const parsed = parse(response);
			return parsed.success
				? ok(parsed.data)
				: err({ code: "protocol", detail: "Invalid response" });
		},
	};
	const acquire = vi.fn(async (_dir: string) => ok(transport));
	const api = skillRuntimeRequests({
		acquire,
		current: () => (current ? transport : undefined),
	});
	return {
		api,
		acquire,
		sent,
		transport,
		answer: (value: unknown) => {
			response = value;
		},
		replace: () => {
			current = false;
		},
		duringReply: (action: () => void) => {
			beforeReply = action;
		},
	};
};

it("keeps exact selections and the same request identity on explicit retry", async () => {
	const s = setup();
	await s.api.skillsRuntime("/a");
	s.answer({ wrong: true });
	expect(await s.api.threadSkillsStart("/a", input)).toMatchObject({
		ok: false,
	});
	expect(s.sent).toHaveLength(2);
	s.answer(started);
	expect(await s.api.threadSkillsStart("/a", input)).toEqual(ok(started));
	expect(s.sent[1]).toEqual(s.sent[2]);
	expect(s.sent[2]).toMatchObject({
		method: DAEMON_METHODS.threadSkillsStart,
		input,
	});
	expect(input.skills?.selected).toHaveLength(1);
	expect(s.acquire).toHaveBeenCalledTimes(1);
	expect(s.transport.retire).not.toHaveBeenCalled();
});

it.each(["unknown", "workspace", "session", "replaced"])(
	"refuses %s origins without acquiring or sending",
	async (kind) => {
		const s = setup();
		if (kind !== "unknown") await s.api.skillsRuntime("/a");
		if (kind === "replaced") s.replace();
		const calls = s.sent.length;
		expect(
			await s.api.threadSkillsStart(kind === "workspace" ? "/b" : "/a", {
				...input,
				sessionId: kind === "session" ? randomUUID() : sessionId,
			}),
		).toMatchObject({ ok: false, error: { code: "stopped" } });
		expect(s.sent).toHaveLength(calls);
	},
);

it("rejects malformed inputs before any transport request", async () => {
	const s = setup();
	expect(
		await s.api.threadSkillsStart("/a", { ...input, requestId: "bad" }),
	).toMatchObject({
		ok: false,
		error: { code: "protocol" },
	});
	expect(s.sent).toEqual([]);
});

it("rejects a late mutation acknowledgement without replay or retiring its replacement", async () => {
	const s = setup();
	await s.api.skillsRuntime("/a");
	s.answer(started);
	s.duringReply(s.replace);
	expect(await s.api.threadSkillsStart("/a", input)).toMatchObject({
		ok: false,
		error: { code: "stopped" },
	});
	expect(s.sent).toHaveLength(2);
	expect(s.transport.retire).not.toHaveBeenCalled();
});

it("preserves omitted reply policy and rejects a different conversation identity", async () => {
	const s = setup();
	await s.api.skillsRuntime("/a");
	const reply = {
		sessionId,
		requestId: randomUUID(),
		conversationId: started.conversationId,
		expectedRunId: started.runId,
		message: "Continue",
	};
	s.answer(started);
	expect(await s.api.threadSkillsReply("/a", reply)).toEqual(ok(started));
	expect(s.sent.at(-1)?.input).not.toHaveProperty("skills");
	s.answer({ ...started, conversationId: randomUUID() });
	expect(await s.api.threadSkillsReply("/a", reply)).toMatchObject({
		ok: false,
		error: { code: "protocol" },
	});
});

it("forwards exact role selections on the versioned run-start route", async () => {
	const s = setup();
	await s.api.skillsRuntime("/a");
	s.answer({ runId: started.runId });
	const req = {
		sessionId,
		goal: "Build",
		templateId: "web-dev",
		skills: {
			mode: "manual" as const,
			roles: [{ roleId: "developer", selected: input.skills?.selected ?? [] }],
		},
	};
	expect(await s.api.runSkillsStart("/a", req)).toEqual(
		ok({ runId: started.runId }),
	);
	expect(s.sent.at(-1)).toMatchObject({
		method: DAEMON_METHODS.runSkillsStart,
		input: req,
	});
});
