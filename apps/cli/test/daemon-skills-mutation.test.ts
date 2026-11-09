import { randomUUID } from "node:crypto";
import {
	DAEMON_METHODS,
	DaemonSkillsListResultSchema,
	err,
	ok,
	type SkillMutationResult,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	entry,
	mutation,
	previewId,
	skillProtocol,
	sourceId,
} from "./skill-protocol-fixture.js";

let fixture: ReturnType<typeof skillProtocol> | undefined;
afterEach(() => fixture?.close());
const setup = async () => {
	fixture = skillProtocol();
	const list = DaemonSkillsListResultSchema.parse(
		await fixture.client.sendRequest(DAEMON_METHODS.skillsList, {}),
	);
	if (!list.ok) throw new Error("inventory failed");
	const { sessionId } = list.value;
	return { ...fixture, sessionId };
};
const refused = (code: "bad_input" | "stale" | "busy" | "unavailable") => ({
	admitted: false,
	result: err({ code }),
});

describe("skill mutation admission envelopes", () => {
	it("binds both mutations and strips session from capability inputs", async () => {
		const t = await setup();
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsApprove, {
				sessionId: t.sessionId,
				previewId,
			}),
		).toEqual(mutation);
		expect(t.approve).toHaveBeenCalledWith(
			{ previewId },
			expect.any(AbortSignal),
		);
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsDisable, {
				sessionId: t.sessionId,
				sourceId,
				expectedRevision: 1,
			}),
		).toEqual(mutation);
		expect(t.disable).toHaveBeenCalledWith(
			{ sourceId, expectedRevision: 1 },
			expect.any(AbortSignal),
		);
	});

	it("checks stale sessions and malformed requests before invoking mutation", async () => {
		const t = await setup();
		const resolve = vi.spyOn(t.registry, "resolve");
		for (const [method, input] of [
			[DAEMON_METHODS.skillsApprove, { previewId }],
			[DAEMON_METHODS.skillsDisable, { sourceId, expectedRevision: 1 }],
		] as const) {
			expect(
				await t.client.sendRequest(method, {
					...input,
					sessionId: randomUUID(),
				}),
			).toEqual(refused("stale"));
			expect(
				await t.client.sendRequest(method, {
					...input,
					sessionId: t.sessionId,
					idle: true,
				}),
			).toEqual(refused("bad_input"));
		}
		expect(t.approve).not.toHaveBeenCalled();
		expect(t.disable).not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
	});

	it("retains busy refusals and safe admitted failures for exact-host retirement", async () => {
		const t = await setup();
		for (const admitted of [false, true]) {
			const result = { admitted, result: err({ code: "busy" as const }) };
			t.approve.mockResolvedValue(result);
			expect(
				await t.client.sendRequest(DAEMON_METHODS.skillsApprove, {
					sessionId: t.sessionId,
					previewId,
				}),
			).toEqual(result);
		}
		t.disable.mockResolvedValue({
			admitted: true,
			result: err({ code: "storage_failed", sourceId }),
		});
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsDisable, {
				sessionId: t.sessionId,
				sourceId,
				expectedRevision: 1,
			}),
		).toEqual({
			admitted: true,
			result: err({ code: "storage_failed", sourceId }),
		});
	});

	it("fails closed on missing/foreign adapters without calling them", async () => {
		const t = await setup();
		t.registration.dispose();
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsApprove, {
				sessionId: t.sessionId,
				previewId,
			}),
		).toEqual(refused("unavailable"));
		t.provide({ ...t.impl });
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsApprove, {
				sessionId: t.sessionId,
				previewId,
			}),
		).toEqual(refused("unavailable"));
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsDisable, {
				sessionId: t.sessionId,
				sourceId,
				expectedRevision: 1,
			}),
		).toEqual(refused("unavailable"));
		expect(t.approve).not.toHaveBeenCalled();
		expect(t.disable).not.toHaveBeenCalled();
	});

	it("never permits unadmitted success or exposes malformed/throwing outcomes", async () => {
		const t = await setup();
		for (const raw of [
			{ admitted: false, result: ok(entry) },
			{ admitted: true, result: err({ code: "expired", message: "sentinel" }) },
			{ ...mutation, secret: "sentinel" },
		]) {
			for (const [method, params, invoke] of [
				[
					DAEMON_METHODS.skillsApprove,
					{ sessionId: t.sessionId, previewId },
					t.approve,
				],
				[
					DAEMON_METHODS.skillsDisable,
					{
						sessionId: t.sessionId,
						sourceId,
						expectedRevision: 1,
					},
					t.disable,
				],
			] as const) {
				invoke.mockResolvedValue(raw as SkillMutationResult);
				expect(await t.client.sendRequest(method, params)).toEqual({
					admitted: raw.admitted,
					result: err({ code: "unavailable" }),
				});
			}
		}
		t.approve.mockRejectedValue(new Error("secret sentinel"));
		expect(
			await t.client.sendRequest(DAEMON_METHODS.skillsApprove, {
				sessionId: t.sessionId,
				previewId,
			}),
		).toEqual(refused("unavailable"));
	});
});
