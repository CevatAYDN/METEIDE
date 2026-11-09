import { err, ok } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import { SkillSession } from "../src/application/skill-session.js";
import type { SkillManagementService } from "../src/domain/skill-management.js";
import {
	approvedSkill,
	SKILL_PREVIEW,
	SKILL_SESSION,
	SKILL_SOURCE,
	skillEntry,
	skillList,
	skillPreview,
} from "./skill-fixture.js";

const deferred = <T>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
};
const setup = () => {
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
		skillsDisable: vi.fn<SkillManagementService["skillsDisable"]>(async () =>
			ok({
				admitted: true,
				result: ok({ ...approvedSkill, status: "disabled", revision: 2 }),
			}),
		),
		skillsRecover: vi.fn<SkillManagementService["skillsRecover"]>(async () =>
			ok(null),
		),
		skillsRecovery: vi.fn<SkillManagementService["skillsRecovery"]>(async () =>
			ok(null),
		),
	};
	let clock = Date.parse("2026-11-08T12:00:00.000Z");
	const session = new SkillSession({ api, changed: vi.fn(), now: () => clock });
	session.workspace("/w");
	return {
		api,
		session,
		expire: () => {
			clock += 600_000;
		},
	};
};
const reviewCurrent = (session: SkillSession) =>
	session.view().onReview(session.state.inventory?.entries[0] ?? skillEntry);

it("does not discover on workspace changes; explicit discovery distinguishes incomplete inventory", async () => {
	const { api, session } = setup();
	expect(session.state.phase).toBe("idle");
	expect(api.skillsList).not.toHaveBeenCalled();
	await session.view().onRefresh();
	expect(session.state.phase).toBe("ready");
	api.skillsList.mockResolvedValueOnce(
		ok({
			ok: true,
			value: {
				sessionId: SKILL_SESSION,
				entries: [],
				complete: false,
				diagnostics: [{ code: "limit_exceeded", location: "root" }],
			},
		}),
	);
	await session.view().onRefresh();
	expect(session.state.inventory?.complete).toBe(false);
	await reviewCurrent(session);
	expect(api.skillsPrepare).not.toHaveBeenCalled();
});

it("drops late reads and retained callbacks on root changes, including A-B-A", async () => {
	const { api, session } = setup();
	const late = deferred<Awaited<ReturnType<typeof api.skillsList>>>();
	api.skillsList.mockReturnValueOnce(late.promise);
	const old = session.view();
	const read = old.onRefresh();
	session.workspace("/b");
	session.workspace("/w");
	late.resolve(ok(skillList));
	await read;
	await old.onRefresh();
	expect(session.state.phase).toBe("idle");
	expect(api.skillsList).toHaveBeenCalledTimes(1);
	await session.view().onRefresh();
	const retained = session.view();
	session.workspace("/b");
	await retained.onReview(skillEntry);
	await retained.onDisable(approvedSkill);
	expect(api.skillsPrepare).not.toHaveBeenCalled();
	expect(api.skillsDisable).not.toHaveBeenCalled();
});

it("reviews full plaintext; expired and busy callbacks never approve", async () => {
	const { api, session, expire } = setup();
	await session.view().onRefresh();
	await reviewCurrent(session);
	expect(session.state.preview?.inspection.text).toContain(
		"END OF FULL PREVIEW",
	);
	expire();
	await session.view().onApprove();
	expect(api.skillsApprove).not.toHaveBeenCalled();
	expect(session.state.error).toEqual({ code: "expired" });
	const pending = deferred<Awaited<ReturnType<typeof api.skillsPrepare>>>();
	api.skillsPrepare.mockReturnValueOnce(pending.promise);
	const review = reviewCurrent(session);
	await session.view().onApprove();
	expect(api.skillsApprove).not.toHaveBeenCalled();
	session.workspace("/b");
	pending.resolve(ok(skillPreview));
	await review;
	expect(session.state.preview).toBeUndefined();
});

it("clears consumed previews and refreshes acknowledged state without optimistic approval", async () => {
	const { api, session } = setup();
	await session.view().onRefresh();
	await reviewCurrent(session);
	const pending = deferred<Awaited<ReturnType<typeof api.skillsApprove>>>();
	api.skillsApprove.mockReturnValueOnce(pending.promise);
	const action = session.view();
	const approval = action.onApprove();
	await action.onApprove();
	expect(api.skillsApprove).toHaveBeenCalledTimes(1);
	expect(session.state.inventory?.entries[0]?.status).toBe("unapproved");
	pending.resolve(ok({ admitted: true, result: ok(approvedSkill) }));
	await approval;
	expect(api.skillsList).toHaveBeenCalledTimes(2);
	expect(session.state.preview).toBeUndefined();
	expect(session.state.inventory?.entries[0]?.status).toBe("unapproved");
	expect(api.skillsApprove).toHaveBeenCalledWith("/w", {
		sessionId: SKILL_SESSION,
		previewId: SKILL_PREVIEW,
	});
});

it("retains admitted failure after authoritative refresh and failed refresh never looks empty", async () => {
	const { api, session } = setup();
	await session.view().onRefresh();
	await reviewCurrent(session);
	api.skillsApprove.mockResolvedValueOnce(
		ok({ admitted: true, result: err({ code: "storage_failed" }) }),
	);
	await session.view().onApprove();
	expect(session.state.error).toEqual({ code: "storage_failed" });
	api.skillsList.mockResolvedValueOnce(
		err({ code: "refused", detail: "unavailable" }),
	);
	await session.view().onRefresh();
	expect(session.state.phase).toBe("error");
	expect(session.state.inventory?.entries).toEqual([skillEntry]);
	await reviewCurrent(session);
	expect(api.skillsPrepare).toHaveBeenCalledTimes(1);
});

it("makes lost acknowledgements recovery-only; explicit recovery does not replay approval", async () => {
	const { api, session } = setup();
	await session.view().onRefresh();
	await reviewCurrent(session);
	api.skillsApprove.mockResolvedValueOnce(
		err({ code: "protocol", detail: "lost" }),
	);
	await session.view().onApprove();
	expect(session.state.phase).toBe("recovery");
	await session.view().onApprove();
	await session.view().onRefresh();
	expect(api.skillsApprove).toHaveBeenCalledTimes(1);
	expect(api.skillsList).toHaveBeenCalledTimes(1);
	await session.view().onRecover();
	expect(api.skillsRecover).toHaveBeenCalledWith("/w", SKILL_SESSION);
	expect(api.skillsList).toHaveBeenCalledTimes(2);
});

it("disable requires a listed enabled grant and sends its exact revision; busy is a typed error", async () => {
	const { api, session } = setup();
	await session.view().onRefresh();
	await session.view().onDisable(approvedSkill);
	expect(api.skillsDisable).not.toHaveBeenCalled();
	api.skillsList.mockResolvedValueOnce(
		ok({
			ok: true,
			value: {
				sessionId: SKILL_SESSION,
				entries: [approvedSkill],
				complete: true,
				diagnostics: [],
			},
		}),
	);
	await session.view().onRefresh();
	api.skillsDisable.mockResolvedValueOnce(
		ok({ admitted: false, result: err({ code: "busy" }) }),
	);
	await session
		.view()
		.onDisable(session.state.inventory?.entries[0] ?? skillEntry);
	expect(api.skillsDisable).toHaveBeenCalledWith("/w", {
		sessionId: SKILL_SESSION,
		sourceId: SKILL_SOURCE,
		expectedRevision: 1,
	});
	expect(session.state).toMatchObject({
		phase: "ready",
		busy: false,
		error: { code: "busy" },
	});
});

it("allows only exact acknowledged revocation from incomplete historical inventory", async () => {
	const { api, session } = setup();
	const receipt = {
		source: skillEntry.source,
		status: "unavailable" as const,
		revision: 7,
		approvedSha256: "b".repeat(64),
		diagnostics: [{ code: "limit_exceeded" as const }],
	};
	const inventory = ok({
		ok: true as const,
		value: {
			sessionId: SKILL_SESSION,
			entries: [receipt],
			complete: false,
			diagnostics: [{ code: "limit_exceeded" as const }],
		},
	});
	api.skillsList.mockResolvedValue(inventory);
	await session.view().onRefresh();
	const entry = session.state.inventory?.entries[0] ?? skillEntry;
	expect(session.state.phase).toBe("ready");
	expect(entry.currentSha256).toBeUndefined();
	await session.view().onReview(entry);
	await session.view().onApprove();
	await session.view().onDisable({ ...entry });
	expect(api.skillsPrepare).not.toHaveBeenCalled();
	expect(api.skillsApprove).not.toHaveBeenCalled();
	expect(api.skillsDisable).not.toHaveBeenCalled();
	api.skillsList.mockResolvedValueOnce(
		err({ code: "refused", detail: "failed" }),
	);
	await session.view().onRefresh();
	await session.view().onDisable(entry);
	expect(api.skillsDisable).not.toHaveBeenCalled();
	await session.view().onRefresh();
	const current = session.state.inventory?.entries[0] ?? skillEntry;
	const retained = session.view();
	const pending = deferred<Awaited<ReturnType<typeof api.skillsDisable>>>();
	api.skillsDisable.mockReturnValueOnce(pending.promise);
	const disable = retained.onDisable(current);
	await retained.onDisable(current);
	expect(api.skillsDisable).toHaveBeenCalledTimes(1);
	expect(api.skillsDisable).toHaveBeenCalledWith("/w", {
		sessionId: SKILL_SESSION,
		sourceId: SKILL_SOURCE,
		expectedRevision: 7,
	});
	session.workspace("/b");
	session.workspace("/w");
	await retained.onDisable(current);
	pending.resolve(ok({ admitted: false, result: err({ code: "busy" }) }));
	await disable;
	expect(api.skillsDisable).toHaveBeenCalledTimes(1);
	expect(session.state).toEqual({ phase: "idle", busy: false });
});
