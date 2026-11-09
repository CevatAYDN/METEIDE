import { randomUUID } from "node:crypto";
import { DAEMON_METHODS, err, ok } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import type { SkillTransport } from "../src/infrastructure/skill-requests.js";
import { skillRuntimeRequests } from "../src/infrastructure/skill-runtime-requests.js";

const runId = randomUUID();
const sessionId = randomUUID();
const setup = () => {
	let current = true;
	let response: unknown = ok({ kind: "legacy", runId });
	let beforeReply = () => {};
	const sent: { method: string; input: object }[] = [];
	const transport: SkillTransport = {
		identity: {},
		current: () => current,
		ended: () => !current,
		retire: vi.fn(async () => {}),
		send: async (method, input, parse) => {
			sent.push({ method, input });
			beforeReply();
			const parsed = parse(response);
			return parsed.success
				? ok(parsed.data)
				: err({ code: "protocol", detail: "Invalid fixture response" });
		},
	};
	const acquire = vi.fn(async (_dir: string) => ok(transport));
	return {
		api: skillRuntimeRequests({ acquire }),
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

it("keeps catalog/session identity and distinguishes unavailable from an empty catalog", async () => {
	const s = setup();
	const catalog = { status: "ready", entries: [], diagnostics: [] };
	s.answer(ok({ sessionId, catalog }));
	expect(await s.api.skillsRuntime("/a")).toEqual(
		ok(ok({ sessionId, catalog })),
	);
	s.answer(err({ code: "unavailable" }));
	expect(await s.api.skillsRuntime("/a")).toEqual(
		ok(err({ code: "unavailable" })),
	);
	expect(s.acquire).toHaveBeenCalledWith("/a");
	expect(s.sent.map(({ method }) => method)).toEqual([
		DAEMON_METHODS.skillsRuntime,
		DAEMON_METHODS.skillsRuntime,
	]);
});

it("validates read inputs before acquiring and uses the exact run/context request", async () => {
	const s = setup();
	expect(await s.api.runSkillsRead("/a", { runId: "bad" })).toMatchObject({
		ok: false,
	});
	expect(s.acquire).not.toHaveBeenCalled();
	expect(await s.api.runSkillsRead("/a", { runId })).toEqual(
		ok(ok({ kind: "legacy", runId })),
	);
	const contextId = randomUUID();
	s.answer(err({ code: "not_found" }));
	expect(await s.api.runSkillsRead("/a", { runId, contextId })).toEqual(
		ok(err({ code: "not_found" })),
	);
	expect(s.sent.at(-1)).toEqual({
		method: DAEMON_METHODS.runSkillsRead,
		input: { runId, contextId },
	});
});

it.each(["catalog", "read"] as const)(
	"rejects a late %s reply after transport replacement",
	async (kind) => {
		const s = setup();
		if (kind === "catalog")
			s.answer(
				ok({
					sessionId,
					catalog: { status: "ready", entries: [], diagnostics: [] },
				}),
			);
		s.duringReply(s.replace);
		const result =
			kind === "catalog"
				? await s.api.skillsRuntime("/a")
				: await s.api.runSkillsRead("/a", { runId });
		expect(result).toMatchObject({ ok: false, error: { code: "stopped" } });
		expect(s.sent).toHaveLength(1);
		expect(s.transport.retire).not.toHaveBeenCalled();
	},
);

it.each([
	ok({ kind: "legacy", runId: randomUUID() }),
	ok({ kind: "legacy", runId, extra: true }),
	ok({
		kind: "summary",
		runId,
		policy: { mode: "auto", roles: [] },
		contexts: [],
	}),
])("refuses mismatched or malformed detail evidence %#", async (response) => {
	const s = setup();
	s.answer(response);
	expect(
		await s.api.runSkillsRead("/a", { runId, contextId: randomUUID() }),
	).toMatchObject({
		ok: false,
		error: { code: "protocol" },
	});
});

it("preserves a typed integrity failure without turning it into empty evidence", async () => {
	const s = setup();
	s.answer(err({ code: "integrity_failed" }));
	expect(await s.api.runSkillsRead("/a", { runId })).toEqual(
		ok(err({ code: "integrity_failed" })),
	);
});
