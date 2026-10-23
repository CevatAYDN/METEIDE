import { afterEach, describe, expect, it } from "vitest";
import { createRestartPolicy } from "../src/domain/restart-policy.js";
import { createDaemonHost } from "../src/infrastructure/daemon-host.js";
import { fakeDaemon } from "./fake-daemon.js";

// The host over real pipes: a fake daemon is a Node child that speaks the daemon protocol.

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
	for (const c of cleanup.splice(0)) await c();
});

const setup = async (max = 3) => {
	const fake = await fakeDaemon();
	let clock = 0;
	const events: string[] = [];
	const bad: string[] = [];
	const host = createDaemonHost({
		spawn: fake.spawn,
		policy: createRestartPolicy(max, 1000),
		now: () => clock,
		onEvent: (dir, e) => void events.push(`${dir} ${e.type}`),
		onBadEvent: (dir) => void bad.push(dir),
	});
	cleanup.push(host.stop, fake.close);
	const tick = (ms: number) => {
		clock += ms;
	};
	return { fake, host, tick, events, bad };
};

describe("the daemon host", () => {
	it("starts a daemon on the first call and answers from the same one after", async () => {
		const { fake, host } = await setup();
		fake.state.mode = "one";
		const first = await host.status("/work/a");
		expect(first.ok && first.value.map((r) => r.goal)).toEqual(["fix it"]);
		const second = await host.status("/work/a");
		expect(second.ok).toBe(true);
		expect(fake.state.starts).toEqual(["/work/a"]);
	});

	it("carries the daemon's refusal and refuses an answer that does not parse", async () => {
		const { host } = await setup();
		expect(await host.status("/w", "refuse")).toEqual({
			ok: false,
			error: { code: "refused", detail: "run not found" },
		});
		const garbage = await host.status("/w", "garbage");
		expect(!garbage.ok && garbage.error.code).toBe("protocol");
	});

	it("shows what core-engine waits for and keeps the daemon, so the restart limit never counts it", async () => {
		const { fake, host } = await setup(1);
		fake.state.mode = "notready";
		for (let i = 0; i < 4; i++)
			expect(await host.status("/w")).toEqual({
				ok: false,
				error: {
					code: "not_ready",
					detail:
						"core-engine is not active; Add a provider key with: mete key set openrouter",
				},
			});
		expect(fake.state.starts).toEqual(["/w"]);
	});

	it("treats error data that does not parse as a protocol fault", async () => {
		const { host } = await setup();
		const odd = await host.status("/w", "baddata");
		expect(!odd.ok && odd.error).toEqual({ code: "protocol", detail: "odd" });
	});

	it("forwards the daemon's events in order with their folder and reports one that is not in the catalog", async () => {
		const { fake, host, events, bad } = await setup();
		fake.state.mode = "events";
		expect((await host.status("/w")).ok).toBe(true);
		expect(events).toEqual(["/w run.created", "/w run.started"]);
		expect(bad).toEqual(["/w"]);
	});

	it("starts a run and carries the router's suggestions when it is unsure", async () => {
		const { host } = await setup();
		expect(await host.startRun("/w", { goal: "fix it" })).toEqual({
			ok: true,
			value: { runId: "6f1c3d52-9b7e-4a52-8d5f-0a1b2c3d4e5f" },
		});
		expect(await host.startRun("/w", { goal: "unsure" })).toEqual({
			ok: false,
			error: {
				code: "choose_template",
				detail: "the router is unsure",
				suggestions: ["research", "web-dev"],
			},
		});
		expect(
			(await host.startRun("/w", { goal: "unsure", templateId: null })).ok,
		).toBe(true);
	});

	it("approves and resumes, shows a refusal and refuses an answer that is not null", async () => {
		const { host } = await setup();
		expect(await host.approve("/w", "r1", { decision: "approve" })).toEqual({
			ok: true,
			value: null,
		});
		expect(await host.approve("/w", "late", { decision: "approve" })).toEqual({
			ok: false,
			error: {
				code: "refused",
				detail: "the run is completed, not paused for approval",
			},
		});
		expect(await host.resume("/w", "r1")).toEqual({ ok: true, value: null });
		const odd = await host.resume("/w", "late");
		expect(!odd.ok && odd.error.code).toBe("protocol");
	});

	it("asks a run's events with the count of unreadable rows, and refuses a bad answer", async () => {
		const { fake, host } = await setup();
		const runId = "6f1c3d52-9b7e-4a52-8d5f-0a1b2c3d4e5f";
		const r = await host.events("/w", runId);
		expect(r.ok && r.value.unreadable).toBe(1);
		expect(r.ok && r.value.events.map((e) => e.type)).toEqual(["run.started"]);
		expect(await host.events("/w", "other")).toEqual({
			ok: false,
			error: { code: "refused", detail: "run not found" },
		});
		fake.state.mode = "badevents";
		const odd = await host.events("/v", runId);
		expect(!odd.ok && odd.error.code).toBe("protocol");
	});

	it("asks the audit log with its filters", async () => {
		const { host } = await setup();
		const all = await host.audit("/w", {});
		expect(all.ok && all.value.entries.map((e) => e.capability)).toEqual([
			"fs.edit@1",
		]);
		expect(await host.audit("/w", { verdict: "deny" })).toEqual({
			ok: true,
			value: { entries: [] },
		});
	});

	it("lists the folder's team templates (ADR-058)", async () => {
		const { host } = await setup();
		expect(await host.templates("/w")).toEqual({
			ok: true,
			value: { templates: [{ id: "game-studio", name: "Game studio" }] },
		});
	});

	it("sends Stop all and returns the runs the daemon cancelled (ADR-065)", async () => {
		const { host } = await setup();
		expect(await host.stopAll("/w")).toEqual({
			ok: true,
			value: { cancelled: ["6f1c3d52-9b7e-4a52-8d5f-0a1b2c3d4e5f"] },
		});
	});

	it("asks each provider's state and refuses one that does not parse", async () => {
		const { fake, host } = await setup();
		expect(await host.quota("/w")).toEqual({
			ok: true,
			value: {
				providers: [
					{
						id: "groq",
						state: "exhausted",
						resetsAt: "2026-10-24T00:00:00.000Z",
					},
					{ id: "nvidia", state: "no_key" },
				],
				units: [
					{
						providerId: "groq",
						unit: "requests_per_minute",
						scope: null,
						used: 3,
						limit: 30,
						history: [{ at: "2026-10-23T09:00:00.000Z", amount: 3 }],
					},
				],
			},
		});
		fake.state.mode = "badquota";
		const odd = await host.quota("/v");
		expect(!odd.ok && odd.error.code).toBe("protocol");
	});

	it("restarts the daemon on request and waits for it, without counting it as a restart", async () => {
		const { fake, host } = await setup(0);
		expect((await host.status("/w")).ok).toBe(true);
		await host.restart();
		expect((await host.status("/w")).ok).toBe(true);
		expect(fake.state.starts).toEqual(["/w", "/w"]);
	});

	it("replaces the daemon when another folder is asked about", async () => {
		const { fake, host } = await setup();
		await host.status("/work/a");
		await host.status("/work/b");
		await host.status("/work/a");
		expect(fake.state.starts).toEqual(["/work/a", "/work/b", "/work/a"]);
	});

	it("starts a crashed daemon again on the next call", async () => {
		const { fake, host } = await setup();
		const lost = await host.status("/w", "die");
		expect(!lost.ok && lost.error).toMatchObject({ code: "stopped" });
		const again = await host.status("/w");
		expect(again.ok).toBe(true);
		expect(fake.state.starts).toEqual(["/w", "/w"]);
	});

	it("says why a daemon that exits at once stopped, then stops starting it at the limit", async () => {
		const { fake, host, tick } = await setup(2);
		fake.state.mode = "exit";
		const first = await host.status("/w");
		expect(!first.ok && first.error.detail).toBe(
			"exit code 1: no provider key for /w",
		);
		await host.status("/w");
		await host.status("/w");
		const blocked = await host.status("/w");
		expect(!blocked.ok && blocked.error).toEqual({
			code: "blocked",
			detail: "exit code 1: no provider key for /w",
		});
		expect(fake.state.starts).toHaveLength(3);
		// Known trap: fixing the cause (a provider key) does not reopen it before the window has passed.
		fake.state.mode = "ok";
		expect((await host.status("/w")).ok).toBe(false);
		tick(1000);
		expect((await host.status("/w")).ok).toBe(true);
	});
});
