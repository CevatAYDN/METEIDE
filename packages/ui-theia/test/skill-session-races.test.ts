import { err, ok } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import { SkillSession } from "../src/application/skill-session.js";
import type { SkillManagementService } from "../src/domain/skill-management.js";
import { approvedSkill, skillList, skillPreview } from "./skill-fixture.js";

const setup = async () => {
	const api = {
		skillsEditor: vi.fn<SkillManagementService["skillsEditor"]>(),
		skillsList: vi.fn<SkillManagementService["skillsList"]>(async () =>
			ok(skillList),
		),
		skillsPrepare: vi.fn<SkillManagementService["skillsPrepare"]>(async () =>
			ok(skillPreview),
		),
		skillsApprove: vi.fn<SkillManagementService["skillsApprove"]>(async () =>
			ok({ admitted: true, result: ok(approvedSkill) }),
		),
		skillsDisable: vi.fn<SkillManagementService["skillsDisable"]>(),
		skillsRecover: vi.fn<SkillManagementService["skillsRecover"]>(),
		skillsRecovery: vi.fn<SkillManagementService["skillsRecovery"]>(async () =>
			ok(null),
		),
	};
	const session = new SkillSession({
		api,
		now: () => Date.parse("2026-11-08T12:00:00.000Z"),
		changed: vi.fn(),
	});
	session.workspace("/a");
	await session.view().onRefresh();
	const review = async () => {
		const entry = session.state.inventory?.entries[0];
		if (!entry) throw new Error("Missing source fixture");
		await session.view().onReview(entry);
	};
	return { api, session, review };
};

it("does not let a retained Approve callback consume a newer preview in the same session", async () => {
	const { api, session, review } = await setup();
	await review();
	const retained = session.view();
	const previewId = "33333333-3333-4333-8333-333333333333";
	if (!skillPreview.ok) throw new Error("Missing preview fixture");
	api.skillsPrepare.mockResolvedValueOnce(
		ok({ ok: true, value: { ...skillPreview.value, previewId } }),
	);
	await review();
	await retained.onApprove();
	expect(api.skillsApprove).not.toHaveBeenCalled();
	await session.view().onApprove();
	expect(api.skillsApprove).toHaveBeenCalledWith(
		"/a",
		expect.objectContaining({ previewId }),
	);
});

it("drops admitted failure and refresh callbacks after workspace A-B-A reselection", async () => {
	const { api, session, review } = await setup();
	await review();
	let resolve!: (value: Awaited<ReturnType<typeof api.skillsApprove>>) => void;
	api.skillsApprove.mockReturnValueOnce(
		new Promise((yes) => {
			resolve = yes;
		}),
	);
	const mutation = session.view().onApprove();
	session.workspace("/b");
	session.workspace("/a");
	await session.view().onRefresh();
	resolve(ok({ admitted: true, result: err({ code: "storage_failed" }) }));
	await mutation;
	expect(session.state.phase).toBe("ready");
	expect(session.state.error).toBeUndefined();
	expect(api.skillsList).toHaveBeenCalledTimes(2);
});

it("refuses malformed previews and inventory without creating approvable or empty state", async () => {
	const { api, session, review } = await setup();
	api.skillsPrepare.mockResolvedValueOnce(ok({ ...skillPreview, extra: true }));
	await review();
	expect(session.state.preview).toBeUndefined();
	expect(session.state.error).toEqual({ code: "transport" });
	await session.view().onApprove();
	expect(api.skillsApprove).not.toHaveBeenCalled();
	api.skillsList.mockResolvedValueOnce(ok({ ...skillList, extra: true }));
	await session.view().onRefresh();
	expect(session.state.phase).toBe("error");
	expect(session.state.inventory?.entries).toHaveLength(1);
});

it("refreshes previously requested inventory on reconnect but never starts discovery from idle", async () => {
	const { api, session, review } = await setup();
	await review();
	const retained = session.view();
	await session.reconnect();
	expect(session.state.preview).toBeUndefined();
	await retained.onApprove();
	expect(api.skillsApprove).not.toHaveBeenCalled();
	expect(api.skillsList).toHaveBeenCalledTimes(2);
	session.workspace("/b");
	await session.reconnect();
	expect(api.skillsList).toHaveBeenCalledTimes(2);
});
