import { expect, it, vi } from "vitest";
import { replyShown } from "../src/application/reply-shown.js";

it("keeps the original conversation title and does not navigate after the selection changes", async () => {
	const shown = { dir: "/w", runId: "old", goal: "selam" };
	const show = vi.fn(async () => {});
	const daemon = {
		replyRun: vi.fn(async () => ({
			ok: true as const,
			value: { runId: "next" },
		})),
	};
	expect(
		await replyShown(
			{ daemon, shown, current: () => shown, show },
			"next message",
		),
	).toBeUndefined();
	expect(show).toHaveBeenCalledWith("/w", "next", "selam");
	show.mockClear();
	await replyShown(
		{ daemon, shown, current: () => undefined, show },
		"next message",
	);
	expect(show).not.toHaveBeenCalled();
});

it("returns a refusal without navigating or discarding a draft", async () => {
	const shown = { dir: "/w", runId: "old", goal: "selam" };
	const show = vi.fn(async () => {});
	const daemon = {
		replyRun: vi.fn(async () => ({
			ok: false as const,
			error: { code: "refused" as const, detail: "not completed" },
		})),
	};
	expect(
		await replyShown({ daemon, shown, current: () => shown, show }, "draft"),
	).toContain("not completed");
	expect(show).not.toHaveBeenCalled();
});
