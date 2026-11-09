import { err, ok, type SkillError } from "@mete/contracts";
import { describe, expect, it } from "vitest";
import {
	runSkillMutation,
	type SkillAdmission,
} from "../../src/application/skill-mutation.js";

describe("authoritative skill mutation admission", () => {
	it("waits for a successful drain before reporting cancellation as admitted", async () => {
		const controller = new AbortController();
		let finish: ((result: SkillAdmission) => void) | undefined;
		const drained = new Promise<SkillAdmission>((resolve) => {
			finish = resolve;
		});
		let writes = 0;
		const pending = runSkillMutation(
			{
				admit: () => drained,
				active: () => true,
			},
			controller.signal,
			async () => {
				writes++;
				return err({ code: "unavailable" });
			},
		);
		controller.abort();
		if (!finish) throw new Error("drain missing");
		finish({ admitted: true, result: ok(undefined) });
		expect(await pending).toEqual({
			admitted: true,
			result: { ok: false, error: { code: "aborted" } },
		});
		expect(writes).toBe(0);
	});

	it("does not claim admission for a rejected or throwing guard", async () => {
		for (const admit of [
			async () => ({
				admitted: false,
				result: err<SkillError>({ code: "busy" }),
			}),
			async () => {
				throw new Error("private guard details");
			},
		]) {
			const result = await runSkillMutation(
				{ admit, active: () => true },
				new AbortController().signal,
				async () => {
					throw new Error("must not run");
				},
			);
			expect(result.admitted).toBe(false);
			expect(JSON.stringify(result)).not.toContain("private");
		}
	});

	it("retains admission on work exceptions, invalid responses and retirement during drain", async () => {
		const signal = new AbortController().signal;
		const options = {
			admit: async () => ({ admitted: true, result: ok(undefined) }),
			active: () => true,
		};
		const thrown = await runSkillMutation(options, signal, async () => {
			throw new Error("secret");
		});
		expect(thrown).toEqual({
			admitted: true,
			result: { ok: false, error: { code: "unavailable" } },
		});
		expect(
			await runSkillMutation(options, signal, async () =>
				ok({ wrong: "secret" }),
			),
		).toEqual(thrown);
		let active = true;
		expect(
			await runSkillMutation(
				{
					active: () => active,
					admit: async () => {
						active = false;
						return { admitted: true, result: ok(undefined) };
					},
				},
				signal,
				async () => ok(undefined),
			),
		).toEqual(thrown);
	});

	it("preserves post-quiesce errors and rejects unadmitted success without writing", async () => {
		for (const admitted of [true, false]) {
			let writes = 0;
			const receipt: SkillAdmission = {
				admitted,
				result: admitted ? err({ code: "stale" }) : ok(undefined),
			};
			expect(
				await runSkillMutation(
					{
						admit: async () => receipt,
						active: () => true,
					},
					new AbortController().signal,
					async () => {
						writes++;
						return ok(undefined);
					},
				),
			).toEqual({
				admitted,
				result: {
					ok: false,
					error: { code: admitted ? "stale" : "unavailable" },
				},
			});
			expect(writes).toBe(0);
		}
	});
});
