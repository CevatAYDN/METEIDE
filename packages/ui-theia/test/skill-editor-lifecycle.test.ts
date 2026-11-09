import { ok } from "@mete/contracts";
import URI from "@theia/core/lib/common/uri";
import type { FileService } from "@theia/filesystem/lib/browser/file-service";
import { expect, it, vi } from "vitest";
import type { SkillManagementService } from "../src/domain/skill-management.js";
import { createSkillSettings } from "../src/infrastructure/skill-settings.js";
import { required } from "./required-fixture.js";
import { approvedSkill, SKILL_SESSION, skillPreview } from "./skill-fixture.js";

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
const fixture = async (globalFile?: string) => {
	let changed = (_event: { contains(uri: URI): boolean }) => {};
	const entry = globalFile
		? {
				...approvedSkill,
				source: { ...approvedSkill.source, scope: "global" as const },
			}
		: approvedSkill;
	const listed = {
		ok: true as const,
		value: {
			sessionId: SKILL_SESSION,
			entries: [entry],
			complete: true,
			diagnostics: [],
		},
	};
	const api = {
		skillsList: vi.fn<SkillManagementService["skillsList"]>(async () =>
			ok(listed),
		),
		skillsPrepare: vi.fn<SkillManagementService["skillsPrepare"]>(async () =>
			ok(
				skillPreview.ok
					? {
							...skillPreview,
							value: {
								...skillPreview.value,
								revision: entry.revision,
								expiresAt: new Date(Date.now() + 60_000).toISOString(),
							},
						}
					: skillPreview,
			),
		),
		skillsEditor: vi.fn<SkillManagementService["skillsEditor"]>(async () =>
			ok({
				ok: true,
				value: { sessionId: SKILL_SESSION, source: entry.source },
			}),
		),
		skillsApprove: vi.fn<SkillManagementService["skillsApprove"]>(),
		skillsDisable: vi.fn<SkillManagementService["skillsDisable"]>(),
		skillsRecover: vi.fn<SkillManagementService["skillsRecover"]>(),
		skillsRecovery: vi.fn<SkillManagementService["skillsRecovery"]>(async () =>
			ok(null),
		),
	};
	const disposed = vi.fn();
	const watch = vi.fn(() => ({ dispose: disposed }));
	const open = vi.fn(async (_uri: URI) => {});
	const resolve = vi.fn(async (uri: URI) => ({
		isFile: uri.path.base === "SKILL.md",
		isDirectory: uri.path.base !== "SKILL.md",
		isSymbolicLink: false,
	}));
	const settings = createSkillSettings({
		api,
		dir: async () => "/workspace",
		changed: vi.fn(),
		listen: () => ({ dispose: vi.fn() }),
		editor: {
			globalFile: () => globalFile,
			open,
			files: {
				resolve,
				watch,
				onDidFilesChange: (listener: typeof changed) => {
					changed = listener;
					return { dispose: vi.fn() };
				},
			} as unknown as Pick<
				FileService,
				"resolve" | "watch" | "onDidFilesChange"
			>,
		},
	});
	await Promise.resolve();
	await settings.view().onRefresh();
	return {
		api,
		settings,
		watch,
		open,
		resolve,
		disposed,
		listed,
		entry,
		change: () => changed({ contains: () => true }),
	};
};

it("observes saves during an unresolved editor opening and refreshes the pre-save approval", async () => {
	const s = await fixture();
	const started = deferred(),
		release = deferred();
	s.open.mockImplementation(async () => {
		expect(s.watch).toHaveBeenCalledOnce();
		started.resolve();
		await release.promise;
	});
	const pending = required(s.settings.view().onEdit)(
		required(s.settings.view().state.inventory?.entries[0]),
	);
	await started.promise;
	s.api.skillsList.mockResolvedValue(
		ok({
			ok: true,
			value: {
				...s.listed.value,
				entries: [
					{ ...s.entry, status: "changed", currentSha256: "c".repeat(64) },
				],
			},
		}),
	);
	s.change();
	release.resolve();
	await pending;
	expect(s.settings.view().state.inventory?.entries[0]?.status).toBe("changed");
	expect(s.api.skillsApprove).not.toHaveBeenCalled();
	s.settings.dispose();
});

it("retires an in-flight metadata resolution on same-folder reconnect and keeps new-session evidence", async () => {
	const s = await fixture();
	const started = deferred(),
		release = deferred();
	s.resolve.mockImplementationOnce(async () => {
		started.resolve();
		await release.promise;
		return { isFile: false, isDirectory: true, isSymbolicLink: false };
	});
	const pending = required(s.settings.view().onEdit)(
		required(s.settings.view().state.inventory?.entries[0]),
	);
	await started.promise;
	const replacement = "99999999-9999-4999-8999-999999999999";
	s.api.skillsList.mockResolvedValue(
		ok({ ok: true, value: { ...s.listed.value, sessionId: replacement } }),
	);
	await s.settings.reconnect();
	release.resolve();
	await pending;
	expect(s.open).not.toHaveBeenCalled();
	expect(s.settings.view().state.busy).toBe(false);
	expect(s.settings.view().state.inventory?.sessionId).toBe(replacement);
	s.settings.dispose();
});

it.skipIf(process.platform !== "win32")(
	"converts the native Windows global settings path before resolving its skill",
	async () => {
		const globalFile = "C:\\profiles\\fixture\\METE\\settings.yaml";
		const s = await fixture(globalFile);
		await required(s.settings.view().onEdit)(
			required(s.settings.view().state.inventory?.entries[0]),
		);
		expect(s.open.mock.calls[0]?.[0].toString()).toBe(
			URI.fromFilePath(globalFile)
				.parent.resolve("skills/review-fixture/SKILL.md")
				.toString(),
		);
		s.settings.dispose();
	},
);

it("cleans up a newly registered watch when opening fails", async () => {
	const s = await fixture();
	s.open.mockRejectedValue(new Error("open failed"));
	await required(s.settings.view().onEdit)(
		required(s.settings.view().state.inventory?.entries[0]),
	);
	expect(s.watch).toHaveBeenCalledOnce();
	expect(s.disposed).toHaveBeenCalledOnce();
	expect(s.settings.view().state.error?.code).toBe("unavailable");
	s.settings.dispose();
	expect(s.disposed).toHaveBeenCalledOnce();
});

it("keeps an existing watch after a failed reopening of the same source", async () => {
	const s = await fixture();
	await required(s.settings.view().onEdit)(
		required(s.settings.view().state.inventory?.entries[0]),
	);
	s.open.mockRejectedValue(new Error("reopen failed"));
	await required(s.settings.view().onEdit)(
		required(s.settings.view().state.inventory?.entries[0]),
	);
	expect(s.watch).toHaveBeenCalledOnce();
	expect(s.disposed).not.toHaveBeenCalled();
	const calls = s.api.skillsList.mock.calls.length;
	s.change();
	expect(s.api.skillsList).toHaveBeenCalledTimes(calls + 1);
	s.settings.dispose();
	expect(s.disposed).toHaveBeenCalledOnce();
});
