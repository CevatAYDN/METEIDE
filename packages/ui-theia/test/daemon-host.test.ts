import { afterEach, describe, expect, it } from "vitest";
import { createRestartPolicy } from "../src/domain/restart-policy.js";
import { createDaemonHost } from "../src/infrastructure/daemon-host.js";
import { fakeDaemon } from "./fake-daemon.js";

// The host over real pipes: a fake daemon is a Node child that speaks protocol version 1.

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
	for (const c of cleanup.splice(0)) await c();
});

const setup = async (max = 3) => {
	const fake = await fakeDaemon();
	let clock = 0;
	const host = createDaemonHost({
		spawn: fake.spawn,
		policy: createRestartPolicy(max, 1000),
		now: () => clock,
	});
	cleanup.push(host.stop, fake.close);
	const tick = (ms: number) => {
		clock += ms;
	};
	return { fake, host, tick };
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
