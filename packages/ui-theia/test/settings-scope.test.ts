import { expect, it, vi } from "vitest";
import { switchSettingsScope } from "../src/infrastructure/settings-scope.js";

it("retires connection evidence before changing form targets and restores only the same context", async () => {
	const workspace = vi.fn(async (_dir: string | undefined) => {});
	const retargetAll = vi.fn(async () => {});
	const retarget = vi.fn(async () => {});
	const result = await switchSettingsScope({
		target: "global",
		current: () => true,
		connections: { dir: "/workspace", workspace },
		forms: { retargetAll },
		bindings: { retarget },
		mcp: { retarget },
	});
	expect(result).toBe(true);
	expect(workspace.mock.calls).toEqual([[undefined], ["/workspace"]]);
	expect(retargetAll).toHaveBeenCalledExactlyOnceWith("global");
	expect(retarget).toHaveBeenCalledTimes(2);
});

it("does not retarget a replacement workspace after an awaited connection retirement", async () => {
	let current = true;
	const retargetAll = vi.fn(async () => {});
	expect(
		await switchSettingsScope({
			target: "global",
			current: () => current,
			connections: {
				dir: "/old",
				workspace: async () => {
					current = false;
				},
			},
			forms: { retargetAll },
		}),
	).toBe(false);
	expect(retargetAll).not.toHaveBeenCalled();
});
