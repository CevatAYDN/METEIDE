import { ok, TOOL_CATALOG } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { reply, slow } from "../helpers/engine.js";
import { verificationHarness } from "../helpers/verification.js";
import { verificationOutputs } from "../helpers/verification-outputs.js";

describe("strict catalog output validation", () => {
	it("covers every executable catalog entry", () => {
		expect(new Set(verificationOutputs.map((fixture) => fixture.ref))).toEqual(
			new Set(TOOL_CATALOG.map((entry) => entry.ref)),
		);
	});

	for (const fixture of verificationOutputs)
		for (const valid of [false, true])
			it(`${fixture.ref} ${JSON.stringify(fixture.args)} accepts only a valid output (${valid})`, async () => {
				const h = await verificationHarness(
					JSON.stringify([{ capability: fixture.ref, args: fixture.args }]),
					{
						scripts: [reply("report"), slow],
						tools: [[fixture.ref, async () => ok(valid ? fixture.value : {})]],
					},
				);
				try {
					await vi.waitFor(async () =>
						expect(await h.read()).toMatchObject({
							value: {
								tasks: [
									{
										evaluations: [
											{
												gates: [
													{
														status: valid ? "passed" : "failed",
													},
												],
											},
										],
									},
								],
							},
						}),
					);
					if (valid)
						await vi.waitFor(() =>
							expect(h.engine.status(h.runId)).toMatchObject({
								value: [{ status: "completed" }],
							}),
						);
					else {
						await vi.waitFor(() => expect(h.requests).toHaveLength(2));
						expect(
							h.events.some(
								(event) =>
									event.type === "task.status.changed" &&
									event.payload.to === "submitted",
							),
						).toBe(false);
					}
				} finally {
					await h.close();
				}
			});

	for (const capability of [false, true])
		for (const result of [
			{ exitCode: 1, timedOut: false, status: "failed" },
			{ exitCode: 0, timedOut: true, status: "failed" },
			{ exitCode: null, timedOut: false, status: "not_run" },
		])
			it(`shell spelling=${capability} cannot skip ${JSON.stringify(result)}`, async () => {
				const gate = capability
					? {
							capability: "shell.exec@1",
							args: { command: "check" },
							optional: true,
						}
					: { run: "check", optional: true };
				const h = await verificationHarness(JSON.stringify([gate]), {
					scripts: [reply("report"), slow],
					tools: [
						[
							"shell.exec@1",
							async () =>
								ok({
									exitCode: result.exitCode,
									timedOut: result.timedOut,
									stdout: "",
									stderr: "",
									os: "test",
									shell: "sh",
								}),
						],
					],
				});
				try {
					await vi.waitFor(async () =>
						expect(await h.read()).toMatchObject({
							value: {
								tasks: [
									{
										evaluations: [
											{
												gates: [
													{
														status: result.status,
														...(result.status === "not_run"
															? { reason: "interrupted" }
															: {}),
													},
												],
											},
										],
									},
								],
							},
						}),
					);
					expect(
						h.events.some(
							(event) =>
								event.type === "task.status.changed" &&
								event.payload.to === "submitted",
						),
					).toBe(false);
				} finally {
					await h.close();
				}
			});

	it("rejects a valid git response for a different operation", async () => {
		const h = await verificationHarness(
			"[{ capability: vcs.git@2, args: { op: diff } }]",
			{
				scripts: [reply("report"), slow],
				tools: [
					[
						"vcs.git@2",
						async () => ok({ op: "status", branch: null, files: [] }),
					],
				],
			},
		);
		try {
			await vi.waitFor(() => expect(h.requests).toHaveLength(2));
			expect(await h.read()).toMatchObject({
				value: {
					tasks: [{ evaluations: [{ gates: [{ status: "failed" }] }] }],
				},
			});
		} finally {
			await h.close();
		}
	});
});
