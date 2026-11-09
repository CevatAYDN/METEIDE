import { ok } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { reply, slow } from "../helpers/engine.js";
import { verificationHarness } from "../helpers/verification.js";

const invalidMetadata: readonly {
	name: string;
	value: Record<string, unknown>;
}[] = [
	{ name: "both missing", value: {} },
	{ name: "os missing", value: { shell: "sh" } },
	{ name: "shell missing", value: { os: "test" } },
	{ name: "os not a string", value: { os: 1, shell: "sh" } },
	{ name: "shell not a string", value: { os: "test", shell: null } },
];

const gate = (capability: boolean) =>
	capability
		? {
				capability: "shell.exec@1",
				args: { command: "check" },
				optional: true,
			}
		: { run: "check", optional: true };

describe("strict shell output metadata", () => {
	for (const capability of [false, true]) {
		for (const metadata of invalidMetadata)
			it(`${capability ? "capability" : "run"} rejects ${metadata.name}`, async () => {
				const h = await verificationHarness(
					JSON.stringify([gate(capability)]),
					{
						scripts: [reply("report"), slow],
						tools: [
							[
								"shell.exec@1",
								async () =>
									ok({
										exitCode: 0,
										stdout: "",
										stderr: "",
										timedOut: false,
										...metadata.value,
									}),
							],
						],
					},
				);
				try {
					await vi.waitFor(() => expect(h.requests).toHaveLength(2));
					expect(await h.read()).toMatchObject({
						value: {
							tasks: [
								{
									evaluations: [
										{
											gates: [
												{
													status: "failed",
													optional: true,
													details: "shell.exec@1 returned an unexpected result",
												},
											],
										},
									],
								},
							],
						},
					});
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

		it(`${capability ? "capability" : "run"} accepts both metadata strings`, async () => {
			const h = await verificationHarness(JSON.stringify([gate(capability)]), {
				scripts: [reply("report")],
				tools: [
					[
						"shell.exec@1",
						async () =>
							ok({
								exitCode: 0,
								stdout: "",
								stderr: "",
								timedOut: false,
								os: "test",
								shell: "sh",
							}),
					],
				],
			});
			try {
				await vi.waitFor(() =>
					expect(h.engine.status(h.runId)).toMatchObject({
						value: [{ status: "completed" }],
					}),
				);
				const result = await h.read();
				if (!result.ok) throw new Error("read failed");
				const row = result.value.tasks[0]?.evaluations[0]?.gates[0];
				expect(row?.status).toBe("passed");
				expect(JSON.parse(row?.details ?? "{}")).toMatchObject({
					os: "test",
					shell: "sh",
				});
			} finally {
				await h.close();
			}
		});
	}
});
