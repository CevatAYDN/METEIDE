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
	skillList,
} from "./skill-fixture.js";

const approve = { sessionId: SKILL_SESSION, previewId: SKILL_PREVIEW };
const setup = () => {
	let slot: { dir: string; transport: SkillTransport } | undefined;
	let acknowledgement: Promise<unknown> = Promise.resolve({});
	const calls: { dir: string; method: string }[] = [];
	const closed = new Set<object>();
	const transport = (dir: string, sessionId: string): SkillTransport => {
		const live: SkillTransport = {
			identity: {},
			current: () => slot?.transport === live && !closed.has(live.identity),
			ended: () => closed.has(live.identity),
			send: async (method, _params, parse) => {
				calls.push({ dir, method });
				let raw: unknown = null;
				if (method === DAEMON_METHODS.skillsApprove)
					raw = await acknowledgement;
				else if (method === DAEMON_METHODS.skillsList && skillList.ok)
					raw = { ...skillList, value: { ...skillList.value, sessionId } };
				const parsed = parse(raw);
				return parsed.success
					? ok(parsed.data)
					: err({ code: "protocol", detail: "Malformed acknowledgement" });
			},
			retire: vi.fn(async () => {
				closed.add(live.identity);
			}),
		};
		return live;
	};
	const a = transport("/a", SKILL_SESSION);
	const b = transport("/b", SKILL_PREVIEW);
	const acquire = vi.fn(async (dir: string) => {
		slot = { dir, transport: dir === "/a" ? a : b };
		return ok(slot.transport);
	});
	const api = skillRequests({
		acquire,
		current: (dir) => (slot?.dir === dir ? slot.transport : undefined),
	});
	return {
		api,
		a,
		b,
		acquire,
		calls,
		clear: () => {
			slot = undefined;
		},
		closeA: () => closed.add(a.identity),
		pending: () => {
			let resolve!: (value: unknown) => void;
			acknowledgement = new Promise((yes) => {
				resolve = yes;
			});
			return resolve;
		},
	};
};

it.each(["other workspace", "empty slot"] as const)(
	"retains A recovery independently and recovers its closed origin with %s",
	async (destination) => {
		const s = setup();
		await s.api.skillsList("/a");
		expect(await s.api.skillsApprove("/a", approve)).toMatchObject({
			ok: false,
		});
		expect(await s.api.skillsList("/b")).toMatchObject({
			ok: true,
			value: { ok: true, value: { sessionId: SKILL_PREVIEW } },
		});
		expect(await s.api.skillsRecovery("/a")).toEqual(ok(SKILL_SESSION));
		expect(await s.api.skillsRecovery("/b")).toEqual(ok(null));
		if (destination === "empty slot") s.clear();
		expect(await s.api.skillsList("/a")).toMatchObject({ ok: false });
		expect(s.acquire).toHaveBeenCalledTimes(2);
		expect(await s.api.skillsRecover("/a", SKILL_SESSION)).toMatchObject({
			ok: false,
		});
		expect(s.a.retire).not.toHaveBeenCalled();
		s.closeA();
		expect(await s.api.skillsRecover("/a", SKILL_PREVIEW)).toMatchObject({
			ok: false,
		});
		expect(await s.api.skillsRecover("/a", SKILL_SESSION)).toEqual(ok(null));
		expect(await s.api.skillsRecovery("/a")).toEqual(ok(null));
		expect(s.a.retire).toHaveBeenCalledTimes(1);
		expect(s.b.retire).not.toHaveBeenCalled();
		expect(s.acquire).toHaveBeenCalledTimes(2);
		expect(s.calls).toEqual([
			{ dir: "/a", method: DAEMON_METHODS.skillsList },
			{ dir: "/a", method: DAEMON_METHODS.skillsApprove },
			{ dir: "/b", method: DAEMON_METHODS.skillsList },
		]);
	},
);

it.each([
	{ admitted: true, result: ok(approvedSkill) },
	{ admitted: true, result: err({ code: "storage_failed" as const }) },
])(
	"retires only pending A on its late admitted reply: $result.ok",
	async (reply) => {
		const s = setup();
		await s.api.skillsList("/a");
		const release = s.pending();
		const mutation = s.api.skillsApprove("/a", approve);
		expect(await s.api.skillsList("/b")).toMatchObject({ ok: true });
		expect(await s.api.skillsRecovery("/a")).toEqual(ok(SKILL_SESSION));
		s.closeA();
		expect(await s.api.skillsRecover("/a", SKILL_SESSION)).toMatchObject({
			ok: false,
		});
		expect(s.a.retire).not.toHaveBeenCalled();
		release(reply);
		expect(await mutation).toEqual(ok(reply));
		expect(s.a.retire).toHaveBeenCalledTimes(1);
		expect(s.b.retire).not.toHaveBeenCalled();
		expect(await s.api.skillsRecovery("/a")).toEqual(ok(null));
		expect(await s.api.skillsRecovery("/b")).toEqual(ok(null));
		expect(s.calls).toEqual([
			{ dir: "/a", method: DAEMON_METHODS.skillsList },
			{ dir: "/a", method: DAEMON_METHODS.skillsApprove },
			{ dir: "/b", method: DAEMON_METHODS.skillsList },
		]);
	},
);

it("keeps a late malformed A acknowledgement recoverable after B discovery", async () => {
	const s = setup();
	await s.api.skillsList("/a");
	const release = s.pending();
	const mutation = s.api.skillsApprove("/a", approve);
	expect(await s.api.skillsList("/b")).toMatchObject({ ok: true });
	release({});
	expect(await mutation).toMatchObject({ ok: false });
	expect(await s.api.skillsRecovery("/a")).toEqual(ok(SKILL_SESSION));
	expect(await s.api.skillsList("/b")).toMatchObject({ ok: true });
	expect(await s.api.skillsRecovery("/a")).toEqual(ok(SKILL_SESSION));
	expect(s.a.retire).not.toHaveBeenCalled();
	expect(s.b.retire).not.toHaveBeenCalled();
});
