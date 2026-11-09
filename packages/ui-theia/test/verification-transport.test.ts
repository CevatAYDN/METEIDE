import { afterEach, expect, it } from "vitest";
import { createRestartPolicy } from "../src/domain/restart-policy.js";
import { createDaemonHost } from "../src/infrastructure/daemon-host.js";
import { fakeDaemon } from "./fake-daemon.js";
import {
	VERIFICATION_RUN,
	verificationFixture,
} from "./verification-fixture.js";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
	for (const close of cleanup.splice(0)) await close();
});
const setup = async () => {
	const fake = await fakeDaemon();
	const host = createDaemonHost({
		spawn: fake.spawn,
		policy: createRestartPolicy(0, 1000),
		now: () => 0,
		onEvent: () => {},
		onBadEvent: () => {},
	});
	cleanup.push(host.stop, fake.close);
	return { fake, host };
};

it("reads exact strict and legacy verification through the validated daemon bridge", async () => {
	const { host, fake } = await setup();
	expect(await host.verification("/w", VERIFICATION_RUN)).toEqual({
		ok: true,
		value: verificationFixture,
	});
	fake.state.mode = "legacy-verification";
	expect(await host.verification("/legacy", VERIFICATION_RUN)).toEqual({
		ok: true,
		value: { mode: "legacy", tasks: [] },
	});
});

it("rejects malformed run IDs before starting a daemon", async () => {
	const { host, fake } = await setup();
	expect(await host.verification("/w", "not-a-run")).toMatchObject({
		ok: false,
		error: { code: "protocol" },
	});
	expect(fake.state.starts).toEqual([]);
});

it.each(["bad-verification", "bad-gate-verification"])(
	"rejects %s instead of accepting partial or fabricated evidence",
	async (mode) => {
		const { host, fake } = await setup();
		fake.state.mode = mode;
		expect(await host.verification("/w", VERIFICATION_RUN)).toMatchObject({
			ok: false,
			error: { code: "protocol" },
		});
	},
);

it("keeps missing core and unavailable reads local without a fallback request", async () => {
	const { host, fake } = await setup();
	fake.state.mode = "notready";
	expect(await host.verification("/w", VERIFICATION_RUN)).toMatchObject({
		ok: false,
		error: { code: "not_ready" },
	});
	fake.state.mode = "no-verification";
	expect(await host.verification("/other", VERIFICATION_RUN)).toMatchObject({
		ok: false,
		error: { code: "refused" },
	});
	expect(fake.state.starts).toEqual(["/w", "/other"]);
});
