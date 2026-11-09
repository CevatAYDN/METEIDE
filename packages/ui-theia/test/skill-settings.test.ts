import { ok } from "@mete/contracts";
import { expect, it, vi } from "vitest";
import type { SkillManagementService } from "../src/domain/skill-management.js";
import { createSkillSettings } from "../src/infrastructure/skill-settings.js";
import { skillList } from "./skill-fixture.js";

it("invalidates retained callbacks immediately while roots resolve and never scans at startup", async () => {
	let changed = () => {};
	let dir = "/a";
	let pending: Promise<string> | undefined;
	const api = {
		skillsEditor: vi.fn<SkillManagementService["skillsEditor"]>(),
		skillsList: vi.fn<SkillManagementService["skillsList"]>(async () =>
			ok(skillList),
		),
		skillsPrepare: vi.fn<SkillManagementService["skillsPrepare"]>(),
		skillsApprove: vi.fn<SkillManagementService["skillsApprove"]>(),
		skillsDisable: vi.fn<SkillManagementService["skillsDisable"]>(),
		skillsRecover: vi.fn<SkillManagementService["skillsRecover"]>(),
		skillsRecovery: vi.fn<SkillManagementService["skillsRecovery"]>(async () =>
			ok(null),
		),
	};
	const settings = createSkillSettings({
		api,
		dir: () => pending ?? Promise.resolve(dir),
		changed: vi.fn(),
		listen: (listener) => {
			changed = listener;
			return { dispose: vi.fn() };
		},
	});
	await Promise.resolve();
	expect(api.skillsList).not.toHaveBeenCalled();
	await settings.view().onRefresh();
	const retained = settings.view();
	let resolve!: (value: string) => void;
	pending = new Promise<string>((yes) => {
		resolve = yes;
	});
	changed();
	await retained.onRefresh();
	expect(api.skillsList).toHaveBeenCalledTimes(1);
	dir = "/b";
	pending = undefined;
	changed();
	await Promise.resolve();
	resolve("/a");
	await Promise.resolve();
	await settings.view().onRefresh();
	expect(api.skillsList).toHaveBeenLastCalledWith("/b");
	settings.dispose();
	const calls = api.skillsList.mock.calls.length;
	await settings.view().onRefresh();
	expect(api.skillsList).toHaveBeenCalledTimes(calls);
});
