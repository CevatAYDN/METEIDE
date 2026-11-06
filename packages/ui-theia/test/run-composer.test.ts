import "reflect-metadata";
import { ok } from "@mete/contracts";
import URI from "@theia/core/lib/common/uri";
import { describe, expect, it, vi } from "vitest";
import type { MeteDaemonService } from "../src/domain/status-service.js";
import {
	MeteRunComposer,
	type StartedRun,
} from "../src/infrastructure/run-composer.js";

vi.mock("@theia/workspace/lib/browser/workspace-service", () => ({
	WorkspaceService: class {},
}));
vi.mock("../src/infrastructure/team-editor-contribution.js", () => ({
	EDIT_TEAM_COMMAND: { id: "mete.team.edit" },
	NEW_TEAM_COMMAND: { id: "mete.team.new" },
}));

class RunComposer extends MeteRunComposer {
	constructor(deps: object) {
		super();
		Object.assign(this, deps);
	}
}

const setup = async () => {
	const startRun = vi.fn<MeteDaemonService["startRun"]>(async () =>
		ok({ runId: "started-run" }),
	);
	const composer = new RunComposer({
		daemon: {
			startRun,
			templates: async () =>
				ok({ templates: [{ id: "review-team", name: "Review team" }] }),
			readTemplate: async () => ok({ yaml: "roles: []\n" }),
			chain: async () => ok({ models: [] }),
			changes: async () => ok({ vcs: false, files: [] }),
			estimate: async () => ok({ providers: [], unassigned: 0 }),
			models: async () => ok({ models: [] }),
			quota: async () => ok({ providers: [], units: [] }),
		},
		workspace: {
			roots: Promise.resolve([{ resource: URI.fromFilePath("/w") }]),
		},
		messages: { info: async () => {} },
	});
	await composer.reopen();
	const send = async (goal: string) => {
		const started = new Promise<StartedRun>((resolve) => {
			const listener = composer.onDidStart((run) => {
				listener.dispose();
				resolve(run);
			});
		});
		composer.render().props.onGoal(goal);
		composer.render().props.onStart();
		return started;
	};
	return { composer, startRun, send };
};

describe("conversation-first composer entry", () => {
	it("starts a single agent both initially and after a successful start and reopen", async () => {
		const t = await setup();
		expect(t.composer.render().props.selected).toBe("single");
		expect(await t.send("Hello")).toMatchObject({ goal: "Hello" });
		await t.composer.reopen();
		expect(t.composer.render().props.selected).toBe("single");
		expect(t.composer.render().props.goal).toBe("");
		await t.send("Another conversation");
		expect(t.startRun.mock.calls.map(([, request]) => request)).toEqual([
			{ goal: "Hello", templateId: null },
			{ goal: "Another conversation", templateId: null },
		]);
	});

	it("keeps an explicit team choice across reopen, then defaults the next run to single", async () => {
		const t = await setup();
		t.composer.render().props.onSelect("review-team");
		await t.composer.reopen();
		expect(t.composer.render().props.selected).toBe("review-team");
		await t.send("Review this");
		expect(t.startRun).toHaveBeenLastCalledWith(
			URI.fromFilePath("/w").path.fsPath(),
			{ goal: "Review this", templateId: "review-team" },
		);
		await t.composer.reopen();
		expect(t.composer.render().props.selected).toBe("single");
		t.composer.render().props.onSelect("review-team");
		await t.send("Review again");
		expect(t.startRun.mock.calls[1]?.[1]).toEqual({
			goal: "Review again",
			templateId: "review-team",
		});
	});

	it("still lets an explicit router choice omit the template", async () => {
		const t = await setup();
		t.composer.render().props.onSelect("choose");
		await t.composer.reopen();
		await t.send("Choose for me");
		expect(t.startRun.mock.calls[0]?.[1]).toEqual({ goal: "Choose for me" });
	});
});
