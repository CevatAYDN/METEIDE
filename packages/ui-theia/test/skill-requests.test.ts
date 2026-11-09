import { DAEMON_METHODS, err, ok } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import {
	type SkillTransport,
	skillRequests,
} from "../src/infrastructure/skill-requests.js";
import {
	approvedSkill,
	SKILL_PREVIEW,
	SKILL_SESSION,
	SKILL_SOURCE,
	skillList,
	skillPreview,
} from "./skill-fixture.js";

const setup = () => {
	let raw: unknown = skillList;
	let active: SkillTransport | undefined;
	let beforeReply = () => {};
	let ended = false;
	const requests: string[] = [];
	const transport: SkillTransport = {
		identity: {},
		current: () => active === transport,
		ended: () => ended,
		send: async (method, _params, parse) => {
			requests.push(method);
			beforeReply();
			const parsed = parse(raw);
			return parsed.success
				? ok(parsed.data)
				: err({ code: "protocol", detail: "invalid" });
		},
		retire: vi.fn(async () => {}),
	};
	active = transport;
	const acquire = vi.fn(async () => ok(transport));
	const api = skillRequests({ acquire, current: () => active });
	return {
		api,
		acquire,
		transport,
		requests,
		answer: (value: unknown) => {
			raw = value;
		},
		replace: () => {
			active = { ...transport, identity: {}, retire: vi.fn(async () => {}) };
		},
		clear: () => {
			active = undefined;
		},
		beforeReply: (callback: () => void) => {
			beforeReply = callback;
		},
		current: () => active,
		closeOriginal: () => {
			ended = true;
		},
	};
};
const approve = { sessionId: SKILL_SESSION, previewId: SKILL_PREVIEW };

it("exposes enumerable bound methods for the host's object-spread wiring", async () => {
	const s = setup();
	const host = { ...s.api };
	expect(typeof host.skillsList).toBe("function");
	expect(await host.skillsList("/w")).toEqual(ok(skillList));
});

it("validates before acquiring or dispatching and refuses a session with no list origin", async () => {
	const s = setup();
	expect(
		await s.api.skillsPrepare("/w", {
			sessionId: SKILL_SESSION,
			sourceId: "bad",
		}),
	).toMatchObject({ ok: false });
	expect(await s.api.skillsApprove("/w", approve)).toMatchObject({ ok: false });
	expect(s.acquire).not.toHaveBeenCalled();
	expect(s.requests).toEqual([]);
});

it("uses exact wire methods and retains only validated list/preview sessions", async () => {
	const s = setup();
	expect(await s.api.skillsList("/w")).toEqual(ok(skillList));
	s.answer(skillPreview);
	expect(
		await s.api.skillsPrepare("/w", {
			sessionId: SKILL_SESSION,
			sourceId: SKILL_SOURCE,
		}),
	).toEqual(ok(skillPreview));
	expect(s.requests).toEqual([
		DAEMON_METHODS.skillsList,
		DAEMON_METHODS.skillsPrepare,
	]);
	s.answer({ ...skillPreview, extra: true });
	expect(
		await s.api.skillsPrepare("/w", {
			sessionId: SKILL_SESSION,
			sourceId: SKILL_SOURCE,
		}),
	).toMatchObject({ ok: false, error: { code: "protocol" } });
});

it.each([
	{ admitted: true, result: ok(approvedSkill) },
	{ admitted: true, result: err({ code: "storage_failed" as const }) },
])(
	"retires the captured admitted transport even for a post-admission failure",
	async (response) => {
		const s = setup();
		await s.api.skillsList("/w");
		s.answer(response);
		expect(await s.api.skillsApprove("/w", approve)).toEqual(ok(response));
		expect(s.transport.retire).toHaveBeenCalledTimes(1);
		expect(s.requests).toEqual([
			DAEMON_METHODS.skillsList,
			DAEMON_METHODS.skillsApprove,
		]);
	},
);

it.each(["replace", "clear"] as const)(
	"does not send stale actions or acquire when current transport is %s",
	async (action) => {
		const s = setup();
		await s.api.skillsList("/w");
		s[action]();
		expect(await s.api.skillsApprove("/w", approve)).toMatchObject({
			ok: false,
		});
		expect(await s.api.skillsRecover("/w", SKILL_SESSION)).toMatchObject({
			ok: false,
		});
		expect(s.requests).toEqual([DAEMON_METHODS.skillsList]);
		expect(s.acquire).toHaveBeenCalledTimes(1);
		expect(s.transport.retire).not.toHaveBeenCalled();
	},
);

it.each(["replace", "clear"] as const)(
	"refuses stale list and prepare replies after %s without retirement or replay",
	async (action) => {
		for (const read of ["list", "prepare"] as const) {
			const s = setup();
			if (read === "prepare") {
				await s.api.skillsList("/w");
				s.answer(skillPreview);
			}
			s.beforeReply(s[action]);
			const result =
				read === "list"
					? await s.api.skillsList("/w")
					: await s.api.skillsPrepare("/w", {
							sessionId: SKILL_SESSION,
							sourceId: SKILL_SOURCE,
						});
			expect(result).toMatchObject({ ok: false, error: { code: "stopped" } });
			expect(s.requests).toEqual(
				read === "list"
					? [DAEMON_METHODS.skillsList]
					: [DAEMON_METHODS.skillsList, DAEMON_METHODS.skillsPrepare],
			);
			expect(s.acquire).toHaveBeenCalledTimes(1);
			expect(s.transport.retire).not.toHaveBeenCalled();
			const current = s.current();
			if (current) expect(current.retire).not.toHaveBeenCalled();
		}
	},
);

it.each([
	{ admitted: false, result: err({ code: "busy" }) },
	{ result: ok(approvedSkill) },
	{ admitted: true, result: ok(approvedSkill), extra: true },
	{ admitted: false, result: ok(approvedSkill) },
])(
	"never guesses admission from an unadmitted or malformed acknowledgement",
	async (response) => {
		const s = setup();
		await s.api.skillsList("/w");
		s.answer(response);
		await s.api.skillsApprove("/w", approve);
		expect(s.transport.retire).not.toHaveBeenCalled();
		expect(s.requests).toHaveLength(2);
	},
);

it("requires explicit recovery and quiesces only the captured session without replay", async () => {
	const s = setup();
	await s.api.skillsList("/w");
	s.answer({});
	await s.api.skillsApprove("/w", approve);
	expect(s.transport.retire).not.toHaveBeenCalled();
	s.answer(null);
	expect(await s.api.skillsRecover("/w", SKILL_SESSION)).toEqual(ok(null));
	expect(s.transport.retire).toHaveBeenCalledTimes(1);
	expect(s.requests).toEqual([
		DAEMON_METHODS.skillsList,
		DAEMON_METHODS.skillsApprove,
		DAEMON_METHODS.quiesce,
	]);
});

it("rejects a mismatched preview session and invalid disable revision without a mutation", async () => {
	const s = setup();
	await s.api.skillsList("/w");
	s.answer(
		skillPreview.ok
			? { ok: true, value: { ...skillPreview.value, sessionId: SKILL_PREVIEW } }
			: skillPreview,
	);
	expect(
		await s.api.skillsPrepare("/w", {
			sessionId: SKILL_SESSION,
			sourceId: SKILL_SOURCE,
		}),
	).toMatchObject({ ok: false });
	expect(
		await s.api.skillsDisable("/w", {
			sessionId: SKILL_SESSION,
			sourceId: SKILL_SOURCE,
			expectedRevision: -1,
		}),
	).toMatchObject({ ok: false });
	expect(s.requests).toHaveLength(2);
});

it("retires only the captured process when a replacement appears before an admitted reply", async () => {
	const s = setup();
	await s.api.skillsList("/w");
	s.answer({ admitted: true, result: err({ code: "storage_failed" }) });
	s.beforeReply(s.replace);
	await s.api.skillsApprove("/w", approve);
	expect(s.transport.retire).toHaveBeenCalledTimes(1);
	expect(s.current()?.retire).not.toHaveBeenCalled();
});

it("recovers a known-closed origin without quiescing or closing its same-folder replacement", async () => {
	const s = setup();
	await s.api.skillsList("/w");
	s.answer({});
	await s.api.skillsApprove("/w", approve);
	s.closeOriginal();
	s.replace();
	expect(await s.api.skillsRecover("/w", SKILL_SESSION)).toEqual(ok(null));
	expect(s.requests).toEqual([
		DAEMON_METHODS.skillsList,
		DAEMON_METHODS.skillsApprove,
	]);
	expect(s.current()?.retire).not.toHaveBeenCalled();
});

it("does not let an overlapping list discard the pending mutation's uncertainty", async () => {
	const s = setup();
	await s.api.skillsList("/w");
	let release!: () => void;
	vi.mocked(s.transport.retire).mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	let mutation: Promise<unknown> | undefined;
	s.beforeReply(() => {
		s.beforeReply(() => {});
		s.answer({ admitted: true, result: err({ code: "storage_failed" }) });
		mutation = s.api.skillsApprove("/w", approve);
		s.answer(skillList);
	});
	expect(await s.api.skillsList("/w")).toMatchObject({ ok: false });
	release();
	await mutation;
});
