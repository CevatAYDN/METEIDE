import { randomUUID } from "node:crypto";
import {
	DAEMON_METHODS,
	DaemonSkillsListResultSchema,
	err,
	ok,
	type SkillTrustAdapter,
} from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { preview, skillProtocol, sourceId } from "./skill-protocol-fixture.js";

let fixture: ReturnType<typeof skillProtocol> | undefined;
afterEach(() => fixture?.close());
const setup = () => {
	fixture = skillProtocol();
	return fixture;
};
const sessionOf = async (t: ReturnType<typeof skillProtocol>) => {
	const result = DaemonSkillsListResultSchema.parse(
		await t.client.sendRequest(DAEMON_METHODS.skillsList, {}),
	);
	if (!result.ok) throw new Error("inventory failed");
	return result.value.sessionId;
};

describe("session-bound skill reads", () => {
	it("lists and prepares without a model engine or mutation admission", async () => {
		const t = setup();
		const sessionId = await sessionOf(t);
		expect(await sessionOf(t)).toBe(sessionId);
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsPrepare, {
				sessionId,
				sourceId,
			}),
		).toEqual(ok({ sessionId, ...preview }));
		expect(t.prepare).toHaveBeenCalledWith(
			{ sourceId },
			expect.any(AbortSignal),
		);
		expect(t.approve).not.toHaveBeenCalled();
		expect(t.disable).not.toHaveBeenCalled();
	});

	it("refuses extended inputs and stale sessions before dispatch", async () => {
		const t = setup();
		const sessionId = await sessionOf(t);
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsList, {
				sessionId,
			}),
		).toEqual(err({ code: "bad_input" }));
		for (const params of [
			{ sessionId, sourceId, secret: "sentinel" },
			{ sessionId, sourceId: "unknown" },
			{ sourceId },
		])
			expect(
				await t.client.sendRequest(DAEMON_METHODS.skillsPrepare, params),
			).toEqual(err({ code: "bad_input" }));
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsPrepare, {
				sessionId: randomUUID(),
				sourceId,
			}),
		).toEqual(err({ code: "stale" }));
		expect(t.prepare).not.toHaveBeenCalled();
	});

	it("keeps safe SkillErrors and never echoes unknown failures", async () => {
		const t = setup();
		for (const code of ["not_found", "ignored", "unavailable"] as const) {
			t.status.mockResolvedValue(err({ code, sourceId, location: "source" }));
			expect(await t.client.sendRequest(DAEMON_METHODS.skillsList, {})).toEqual(
				err({ code, sourceId, location: "source" }),
			);
		}
		t.status.mockRejectedValue(new Error("secret sentinel"));
		expect(await t.client.sendRequest(DAEMON_METHODS.skillsList, {})).toEqual(
			err({ code: "unavailable" }),
		);
	});

	it("rejects malformed previews instead of returning a successful review", async () => {
		const t = setup();
		const sessionId = await sessionOf(t);
		t.prepare.mockResolvedValueOnce({
			ok: true,
			value: {
				...preview,
				inspection: { ...preview.inspection, sha256: "wrong" },
			},
		});
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsPrepare, {
				sessionId,
				sourceId,
			}),
		).toEqual(err({ code: "unavailable" }));
	});

	it("refuses malformed results and foreign adapters with trusted labels", async () => {
		const t = setup();
		const sessionId = await sessionOf(t);
		t.status.mockResolvedValue(
			ok({
				entries: [],
				complete: true,
				diagnostics: [],
				secret: "sentinel",
			}) as Awaited<ReturnType<SkillTrustAdapter["status"]>>,
		);
		expect(await t.client.sendRequest(DAEMON_METHODS.skillsList, {})).toEqual(
			err({ code: "unavailable" }),
		);
		t.registration.dispose();
		t.provide({ ...t.impl });
		expect(await t.client.sendRequest(DAEMON_METHODS.skillsList, {})).toEqual(
			err({ code: "unavailable" }),
		);
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsPrepare, {
				sessionId,
				sourceId,
			}),
		).toEqual(err({ code: "unavailable" }));
		expect(t.prepare).not.toHaveBeenCalled();
	});
});
