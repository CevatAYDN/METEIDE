import { ok } from "@mete/contracts";
import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { expect, it, vi } from "vitest";
import type { SkillManagementService } from "../src/domain/skill-management.js";
import { createSkillSettings } from "../src/infrastructure/skill-settings.js";
import { required } from "./required-fixture.js";
import {
	SKILL_SESSION,
	skillEntry,
	skillList,
	skillPreview,
} from "./skill-fixture.js";

it("opens a native source, observes saves without approving, and retires watches on workspace change", async () => {
	let rootChanged = () => {};
	let fileChanged = (_event: { contains(uri: URI): boolean }) => {};
	const watchDisposed = vi.fn();
	const listenerDisposed = vi.fn();
	const watch = vi.fn(() => ({ dispose: watchDisposed }));
	const files = {
		resolve: async (uri: URI) => ({
			isFile: uri.path.base === "SKILL.md",
			isDirectory: uri.path.base !== "SKILL.md",
			isSymbolicLink: false,
		}),
		watch,
		onDidFilesChange: (listener: typeof fileChanged) => {
			fileChanged = listener;
			return { dispose: listenerDisposed };
		},
	};
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
			ok(
				skillPreview.ok
					? {
							...skillPreview,
							value: {
								...skillPreview.value,
								expiresAt: new Date(Date.now() + 60_000).toISOString(),
							},
						}
					: skillPreview,
			),
		),
		skillsApprove: vi.fn<SkillManagementService["skillsApprove"]>(),
		skillsDisable: vi.fn<SkillManagementService["skillsDisable"]>(),
		skillsRecover: vi.fn<SkillManagementService["skillsRecover"]>(),
		skillsRecovery: vi.fn<SkillManagementService["skillsRecovery"]>(async () =>
			ok(null),
		),
	};
	const open = vi.fn(async (_uri: URI) => {});
	const settings = createSkillSettings({
		api,
		dir: async () => "/workspace",
		changed: vi.fn(),
		listen: (listener) => {
			rootChanged = listener;
			return { dispose: vi.fn() };
		},
		editor: {
			files: files as unknown as Pick<
				FileService,
				"resolve" | "watch" | "onDidFilesChange"
			>,
			globalFile: () => undefined,
			open,
		},
	});
	await Promise.resolve();
	expect(api.skillsList).not.toHaveBeenCalled();
	expect(watch).not.toHaveBeenCalled();
	await settings.view().onRefresh();
	await required(settings.view().onEdit)(
		required(settings.view().state.inventory?.entries[0]),
	);
	expect(open.mock.calls[0]?.[0].toString()).toBe(
		URI.fromFilePath("/workspace")
			.resolve(".mete/skills/review-fixture/SKILL.md")
			.toString(),
	);
	expect(watch).toHaveBeenCalledOnce();
	await settings
		.view()
		.onReview(required(settings.view().state.inventory?.entries[0]));
	expect(settings.view().state.preview).toBeDefined();
	const old = settings.view();
	fileChanged({ contains: () => true });
	expect(settings.view().state.preview).toBeUndefined();
	await old.onApprove();
	expect(api.skillsApprove).not.toHaveBeenCalled();
	expect(api.skillsList).toHaveBeenCalledTimes(3);
	rootChanged();
	expect(watchDisposed).toHaveBeenCalledOnce();
	const calls = api.skillsList.mock.calls.length;
	fileChanged({ contains: () => true });
	expect(api.skillsList).toHaveBeenCalledTimes(calls);
	settings.dispose();
	expect(listenerDisposed).toHaveBeenCalledOnce();
	expect(watchDisposed).toHaveBeenCalledOnce();
});
