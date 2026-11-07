import { expect, it } from "vitest";
import { createRestartPolicy } from "../src/domain/restart-policy.js";
import { createDaemonHost } from "../src/infrastructure/daemon-host.js";
import { fakeDaemon } from "./fake-daemon.js";

const identity = {
	runId: "11111111-1111-4111-8111-111111111111",
	taskId: "22222222-2222-4222-8222-222222222222",
	requestId: "33333333-3333-4333-8333-333333333333",
};

it("wires task controls over daemon pipes, including refusal and malformed replies", async () => {
	for (const mode of ["ok", "badtasks", "notasks"]) {
		const fake = await fakeDaemon();
		fake.state.mode = mode;
		const host = createDaemonHost({
			spawn: fake.spawn,
			policy: createRestartPolicy(3, 1000),
			now: Date.now,
			onEvent: () => {},
			onBadEvent: () => {},
		});
		try {
			const pending = await host.taskPending("/w", identity.runId);
			const answer = await host.taskAnswer("/w", {
				...identity,
				decision: "allow",
				scope: "once",
			});
			if (mode === "ok") {
				expect(pending).toMatchObject({
					ok: true,
					value: {
						requests: [identity],
					},
				});
				expect(answer).toEqual({ ok: true, value: null });
			} else {
				const code = mode === "badtasks" ? "protocol" : "refused";
				expect(pending).toMatchObject({ ok: false, error: { code } });
				expect(answer).toMatchObject({ ok: false, error: { code } });
			}
		} finally {
			await host.restart();
			await fake.close();
		}
	}
});
