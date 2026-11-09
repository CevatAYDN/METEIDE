import { err, ok, type SkillSourceDescriptor } from "@mete/contracts";
import { describe, expect, it, vi } from "vitest";
import { SkillSession } from "../src/application/skill-session.js";
import type { SkillManagementService } from "../src/domain/skill-management.js";
import { required } from "./required-fixture.js";
import {
	SKILL_SESSION,
	skillEntry,
	skillList,
	skillPreview,
} from "./skill-fixture.js";

const setup = () => {
	const api = {
		skillsEditor: vi.fn<SkillManagementService["skillsEditor"]>(async () =>
			ok({
				ok: true,
				value: { sessionId: SKILL_SESSION, source: skillEntry.source },
			}),
		),
		skillsList: vi.fn<SkillManagementService["skillsList"]>(async () =>
			ok(skillList),
		),
		skillsPrepare: vi.fn<SkillManagementService["skillsPrepare"]>(async () =>
			ok(skillPreview),
		),
		skillsApprove: vi.fn<SkillManagementService["skillsApprove"]>(),
		skillsDisable: vi.fn<SkillManagementService["skillsDisable"]>(),
		skillsRecover: vi.fn<SkillManagementService["skillsRecover"]>(),
		skillsRecovery: vi.fn<SkillManagementService["skillsRecovery"]>(async () =>
			ok(null),
		),
	};
	const open = vi.fn(
		async (
			_source: SkillSourceDescriptor,
			_current: () => boolean,
			_dir: string,
		) => ok(null),
	);
	const session = new SkillSession({
		api,
		open,
		changed: vi.fn(),
		now: () => Date.parse("2026-11-08T12:00:00Z"),
	});
	session.workspace("/workspace");
	const entry = () => required(session.state.inventory?.entries[0]);
	return { api, open, session, entry };
};

describe("user-initiated skill editing", () => {
	it("resolves the native source before opening and refreshes without approving or writing a preview", async () => {
		const { session, api, open, entry } = setup();
		await session.view().onRefresh();
		await session.view().onReview(entry());
		expect(session.state.preview).toBeDefined();
		await required(session.view().onEdit)(entry());
		expect(api.skillsList).toHaveBeenCalledTimes(2);
		expect(api.skillsEditor).toHaveBeenCalledExactlyOnceWith("/workspace", {
			sessionId: SKILL_SESSION,
			sourceId: skillEntry.source.sourceId,
		});
		expect(open).toHaveBeenCalledOnce();
		expect(open.mock.calls[0]?.[0]).toEqual(entry().source);
		expect(open.mock.calls[0]?.[2]).toBe("/workspace");
		expect(session.state.preview).toBeUndefined();
		expect(api.skillsApprove).not.toHaveBeenCalled();
		expect(api.skillsDisable).not.toHaveBeenCalled();
	});

	it("refuses a stale native source/session instead of opening the old path", async () => {
		const { session, api, open, entry } = setup();
		await session.view().onRefresh();
		api.skillsEditor.mockResolvedValueOnce(
			ok({
				ok: true,
				value: {
					sessionId: "99999999-9999-4999-8999-999999999999",
					source: skillEntry.source,
				},
			}),
		);
		await required(session.view().onEdit)(entry());
		expect(open).not.toHaveBeenCalled();
		expect(session.state.error?.code).toBe("stale");
	});

	it("retires an old edit callback on workspace change and fails closed on a failed fresh read", async () => {
		const { session, api, open, entry } = setup();
		await session.view().onRefresh();
		const old = session.view();
		const source = entry();
		session.workspace("/other");
		await required(old.onEdit)(source);
		expect(open).not.toHaveBeenCalled();
		await session.view().onRefresh();
		api.skillsEditor.mockResolvedValueOnce(
			err({ code: "stopped", detail: "gone" }),
		);
		await required(session.view().onEdit)(entry());
		expect(open).not.toHaveBeenCalled();
		expect(session.state.busy).toBe(false);
	});

	it("uses an unmasked native path rather than an equally valid masked sibling label", async () => {
		const { session, api, open, entry } = setup();
		api.skillsList.mockResolvedValue(
			ok({
				ok: true,
				value: {
					sessionId: SKILL_SESSION,
					complete: true,
					diagnostics: [],
					entries: [
						{
							...skillEntry,
							source: { ...skillEntry.source, path: "masked/SKILL.md" },
						},
					],
				},
			}),
		);
		api.skillsEditor.mockResolvedValue(
			ok({
				ok: true,
				value: {
					sessionId: SKILL_SESSION,
					source: { ...skillEntry.source, path: "secret/SKILL.md" },
				},
			}),
		);
		await session.view().onRefresh();
		await required(session.view().onEdit)(entry());
		expect(open.mock.calls[0]?.[0].path).toBe("secret/SKILL.md");
		expect(entry().source.path).toBe("masked/SKILL.md");
	});

	it("retires a pending editor on reconnect and reads the replacement session after it settles", async () => {
		const { session, api, open, entry } = setup();
		await session.view().onRefresh();
		let entered!: () => void;
		const started = new Promise<void>((done) => {
			entered = done;
		});
		let release!: () => void;
		const pending = new Promise<void>((done) => {
			release = done;
		});
		let opened = false;
		open.mockImplementation(async (_source, current) => {
			entered();
			await pending;
			opened = current();
			return ok(null);
		});
		const editing = required(session.view().onEdit)(entry());
		await started;
		const replacement = "99999999-9999-4999-8999-999999999999";
		api.skillsList.mockResolvedValue(
			ok({
				ok: true,
				value: {
					sessionId: replacement,
					complete: true,
					diagnostics: [],
					entries: [skillEntry],
				},
			}),
		);
		await session.reconnect();
		release();
		await editing;
		expect(opened).toBe(false);
		expect(session.state.busy).toBe(false);
		expect(session.state.inventory?.sessionId).toBe(replacement);
	});

	it("invalidates retained approval previews when a saved source changes", async () => {
		const { session, api, entry } = setup();
		await session.view().onRefresh();
		await session.view().onReview(entry());
		const old = session.view();
		await session.sourceChanged();
		await old.onApprove();
		expect(session.state.preview).toBeUndefined();
		expect(api.skillsApprove).not.toHaveBeenCalled();
		expect(api.skillsList).toHaveBeenCalledTimes(2);
	});

	it("reconciles a source change arriving while preview preparation is in flight", async () => {
		const { session, api, entry } = setup();
		await session.view().onRefresh();
		let resolve!: (
			value: Awaited<ReturnType<SkillManagementService["skillsPrepare"]>>,
		) => void;
		api.skillsPrepare.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const preparing = session.view().onReview(entry());
		await session.sourceChanged();
		resolve(ok(skillPreview));
		await preparing;
		expect(session.state.preview).toBeUndefined();
		expect(session.state.busy).toBe(false);
		expect(api.skillsList).toHaveBeenCalledTimes(2);
	});

	it("keeps uncertain mutation recovery authoritative when reconnect arrives while approval is pending", async () => {
		const { session, api, entry } = setup();
		await session.view().onRefresh();
		await session.view().onReview(entry());
		let resolve!: (
			value: Awaited<ReturnType<SkillManagementService["skillsApprove"]>>,
		) => void;
		api.skillsApprove.mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				}),
		);
		const approving = session.view().onApprove();
		await session.reconnect();
		resolve(err({ code: "stopped", detail: "uncertain" }));
		await approving;
		expect(session.state.phase).toBe("recovery");
		expect(session.state.busy).toBe(false);
		await session.reconnect();
		await session.view().onRefresh();
		await session.view().onApprove();
		expect(api.skillsApprove).toHaveBeenCalledOnce();
		expect(api.skillsList).toHaveBeenCalledOnce();
		expect(api.skillsRecover).not.toHaveBeenCalled();
	});
});
