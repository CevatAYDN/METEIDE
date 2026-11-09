import { afterEach, expect, it } from "vitest";
import { createRestartPolicy } from "../src/domain/restart-policy.js";
import { createDaemonHost } from "../src/infrastructure/daemon-host.js";
import { fakeDaemon } from "./fake-daemon.js";
import { SKILL_SOURCE } from "./skill-fixture.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
});
const setup = async (mode = "ok") => {
	const fake = await fakeDaemon();
	fake.state.mode = mode;
	const closed: string[] = [];
	const host = createDaemonHost({
		spawn: (dir) => {
			const child = fake.spawn(dir);
			child.on("close", () => closed.push(dir));
			return child;
		},
		policy: createRestartPolicy(0, 1000),
		now: () => 0,
		onEvent: () => {},
		onBadEvent: () => {},
	});
	cleanup.push(() => host.restart(), fake.close);
	const list = await host.skillsList("/w");
	if (!list.ok || !list.value.ok) throw new Error("Missing fixture inventory");
	return { host, fake, closed, sessionId: list.value.value.sessionId };
};

it.each(["ok", "skills-admitted-error"])(
	"awaits exact captured process close after %s without automatic reconnect",
	async (mode) => {
		const { host, fake, closed, sessionId } = await setup(mode);
		const prepared = await host.skillsPrepare("/w", {
			sessionId,
			sourceId: SKILL_SOURCE,
		});
		if (!prepared.ok || !prepared.value.ok)
			throw new Error("Missing fixture preview");
		const result = await host.skillsApprove("/w", {
			sessionId,
			previewId: prepared.value.value.previewId,
		});
		expect(result).toMatchObject({ ok: true, value: { admitted: true } });
		expect(closed).toEqual(["/w"]);
		expect(fake.state.starts).toEqual(["/w"]);
		expect(
			await host.skillsApprove("/w", {
				sessionId,
				previewId: prepared.value.value.previewId,
			}),
		).toMatchObject({ ok: false });
		expect(fake.state.starts).toEqual(["/w"]);
	},
);

it.each(["skills-busy", "skills-malformed"])(
	"does not close an unverified %s process or automatically replay",
	async (mode) => {
		const { host, fake, closed, sessionId } = await setup(mode);
		await host.skillsDisable("/w", {
			sessionId,
			sourceId: SKILL_SOURCE,
			expectedRevision: 1,
		});
		expect(closed).toEqual([]);
		expect(fake.state.starts).toEqual(["/w"]);
	},
);

it("rejects callbacks after a same-folder replacement without closing the replacement", async () => {
	const { host, fake, closed, sessionId } = await setup();
	await host.restart();
	await host.skillsList("/w");
	expect(
		await host.skillsPrepare("/w", { sessionId, sourceId: SKILL_SOURCE }),
	).toMatchObject({ ok: false });
	expect(await host.skillsRecover("/w", sessionId)).toMatchObject({
		ok: false,
	});
	expect(fake.state.starts).toEqual(["/w", "/w"]);
	expect(closed).toEqual(["/w"]);
});

it("recovers a closed lost-ack origin without replaying against active workspace B", async () => {
	const { host, fake, closed, sessionId } = await setup("skills-lost");
	expect(
		await host.skillsDisable("/w", {
			sessionId,
			sourceId: SKILL_SOURCE,
			expectedRevision: 1,
		}),
	).toMatchObject({ ok: false });
	fake.state.mode = "one";
	expect(await host.status("/b")).toMatchObject({ ok: true });
	const other = await host.skillsList("/b");
	expect(other).toMatchObject({ ok: true, value: { ok: true } });
	if (!other.ok || !other.value.ok) throw new Error("Missing B inventory");
	expect(other.value.value.sessionId).not.toBe(sessionId);
	expect(await host.skillsRecovery("/w")).toEqual({
		ok: true,
		value: sessionId,
	});
	expect(await host.skillsRecovery("/b")).toEqual({ ok: true, value: null });
	expect(await host.skillsList("/w")).toMatchObject({
		ok: false,
	});
	expect(await host.skillsRecover("/w", sessionId)).toEqual({
		ok: true,
		value: null,
	});
	expect(
		await host.skillsDisable("/w", {
			sessionId,
			sourceId: SKILL_SOURCE,
			expectedRevision: 1,
		}),
	).toMatchObject({ ok: false });
	expect(await host.skillsList("/b")).toMatchObject({
		ok: true,
		value: { ok: true, value: { sessionId: other.value.value.sessionId } },
	});
	expect(fake.state.starts).toEqual(["/w", "/b"]);
	expect(closed).toEqual(["/w"]);
});

it("explicitly recovers a closed origin without spending crash retry budget or replaying", async () => {
	const { host, fake, sessionId } = await setup("skills-lost");
	await host.skillsDisable("/w", {
		sessionId,
		sourceId: SKILL_SOURCE,
		expectedRevision: 1,
	});
	fake.state.mode = "ok";
	expect(await host.skillsRecover("/w", sessionId)).toEqual({
		ok: true,
		value: null,
	});
	expect(fake.state.starts).toEqual(["/w"]);
	expect(await host.skillsList("/w")).toMatchObject({ ok: true });
	expect(fake.state.starts).toEqual(["/w", "/w"]);
});

it("retains uncertain A across status-driven closure and B discovery", async () => {
	const { host, fake, closed, sessionId } = await setup("skills-malformed");
	expect(
		await host.skillsDisable("/w", {
			sessionId,
			sourceId: SKILL_SOURCE,
			expectedRevision: 1,
		}),
	).toMatchObject({ ok: false });
	expect(closed).toEqual([]);
	fake.state.mode = "one";
	expect(await host.status("/b")).toMatchObject({ ok: true });
	expect(closed).toEqual(["/w"]);
	const other = await host.skillsList("/b");
	expect(other).toMatchObject({ ok: true, value: { ok: true } });
	if (!other.ok || !other.value.ok) throw new Error("Missing B inventory");
	expect(other.value.value.sessionId).not.toBe(sessionId);
	expect(await host.skillsRecovery("/w")).toEqual({
		ok: true,
		value: sessionId,
	});
	expect(await host.skillsRecover("/w", sessionId)).toEqual({
		ok: true,
		value: null,
	});
	expect(await host.skillsList("/b")).toMatchObject({
		ok: true,
		value: { ok: true, value: { sessionId: other.value.value.sessionId } },
	});
	expect(fake.state.starts).toEqual(["/w", "/b"]);
	expect(closed).toEqual(["/w"]);
});
