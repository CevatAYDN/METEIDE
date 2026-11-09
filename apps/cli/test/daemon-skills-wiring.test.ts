import {
	DAEMON_METHODS,
	DAEMON_PROTOCOL_VERSION,
	DaemonSkillsListResultSchema,
	DaemonSkillsPrepareResultSchema,
	err,
	ok,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	mutation,
	previewId,
	skillProtocol,
	sourceId,
} from "./skill-protocol-fixture.js";

const fixtures: ReturnType<typeof skillProtocol>[] = [];
afterEach(async () => {
	for (const fixture of fixtures.splice(0)) await fixture.close();
});
const setup = () => {
	const fixture = skillProtocol(true);
	fixtures.push(fixture);
	return fixture;
};
const sessionOf = async (fixture: ReturnType<typeof skillProtocol>) => {
	const result = DaemonSkillsListResultSchema.parse(
		await fixture.client.sendRequest(DAEMON_METHODS.skillsList, {}),
	);
	if (!result.ok) throw new Error("inventory failed");
	return result.value.sessionId;
};

describe("daemon skill wiring and response lifetime", () => {
	it("serves all four protocol35 routes without stopping the app before response", async () => {
		expect(DAEMON_PROTOCOL_VERSION).toBe(37);
		const t = setup();
		const sessionId = await sessionOf(t);
		const prepared = DaemonSkillsPrepareResultSchema.parse(
			await t.client.sendRequest(DAEMON_METHODS.skillsPrepare, {
				sessionId,
				sourceId,
			}),
		);
		expect(prepared.ok).toBe(true);
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsApprove, {
				sessionId,
				previewId,
			}),
		).toEqual(mutation);
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsDisable, {
				sessionId,
				sourceId,
				expectedRevision: 1,
			}),
		).toEqual(mutation);
		expect(await sessionOf(t)).toBe(sessionId);
		expect(t.stop).not.toHaveBeenCalled();
	});

	it("gives each replacement daemon a fresh session before any mutation dispatch", async () => {
		const first = setup();
		const stale = await sessionOf(first);
		const replacement = setup();
		expect(await sessionOf(replacement)).not.toBe(stale);
		expect(
			await replacement.client.sendRequest(DAEMON_METHODS.skillsApprove, {
				sessionId: stale,
				previewId,
			}),
		).toEqual({ admitted: false, result: err({ code: "stale" }) });
		expect(replacement.approve).not.toHaveBeenCalled();
		expect(replacement.stop).not.toHaveBeenCalled();
	});

	it("aborts pending reads on original-daemon shutdown without closing its replacement", async () => {
		const original = setup();
		let release = () => {};
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		let signal: AbortSignal | undefined;
		original.status.mockImplementationOnce(async (current) => {
			signal = current;
			await wait;
			return ok({ entries: [], complete: true, diagnostics: [] });
		});
		const pending = original.client
			.sendRequest(DAEMON_METHODS.skillsList, {})
			.then(
				() => "responded",
				() => "closed",
			);
		await vi.waitFor(() => expect(signal).toBeDefined());
		const replacement = setup();
		const replacementSession = await sessionOf(replacement);
		await original.close();
		expect(signal?.aborted).toBe(true);
		release();
		expect(await pending).toBe("closed");
		expect(await sessionOf(replacement)).toBe(replacementSession);
		expect(replacement.stop).not.toHaveBeenCalled();
	});
});
