import { describe, expect, it } from "vitest";
import { type HomeModel, homeModel } from "../src/domain/home-model.js";
import {
	HOME_SECTIONS,
	sectionCount,
	sectionId,
} from "../src/domain/home-sections.js";
import type { StatusRuns } from "../src/domain/status-service.js";

// What each section of the METE view counts in its title (ADR-109): the number beside the words,
// and none while the panel cannot count. The widget only formats what this answers.

const AT = "2026-10-23T10:00:00.000Z";

const run = (status: string, pauseReason?: string) =>
	({
		...(pauseReason ? { pauseReason } : {}),
		id: crypto.randomUUID(),
		workspaceId: crypto.randomUUID(),
		templateId: null,
		goal: "g",
		status,
		autonomyLevel: 2,
		budget: { cloudRequests: 10, maxHours: 1 },
		createdAt: AT,
	}) as StatusRuns[number];

const runs = (...rows: StatusRuns) => homeModel({ ok: true, value: rows }, AT);

describe("the METE view's sections", () => {
	it("stacks the sections in the order the view shows them", () => {
		expect(HOME_SECTIONS).toEqual(["waiting", "runs", "workspaces", "quota"]);
	});

	it("names each section's widget after itself", () => {
		expect(sectionId("waiting")).toBe("mete.home.waiting");
		expect(sectionId("quota")).toBe("mete.home.quota");
	});

	it("counts the runs that wait for the human", () => {
		const model = runs(
			run("paused", "approval"),
			run("completed"),
			run("paused", "approval"),
		);
		expect(sectionCount("waiting", model, 0)).toBe(2);
	});

	it("counts every run, whatever its status", () => {
		const model = runs(
			run("running"),
			run("completed"),
			run("paused", "quota"),
		);
		expect(sectionCount("runs", model, 0)).toBe(3);
	});

	it("counts the folders opened before", () => {
		expect(sectionCount("workspaces", runs(), 4)).toBe(4);
	});

	it("counts nothing for quota, whose card speaks for itself", () => {
		expect(sectionCount("quota", runs(run("running")), 3)).toBeUndefined();
	});

	it("counts nothing while the daemon has not answered", () => {
		const loading: HomeModel = { kind: "loading" };
		expect(sectionCount("waiting", loading, 0)).toBeUndefined();
		expect(sectionCount("runs", loading, 0)).toBeUndefined();
	});

	it("counts nothing when the answer failed", () => {
		const failed = homeModel(
			{ ok: false, error: { code: "not_ready", detail: "no key" } },
			AT,
		);
		expect(sectionCount("runs", failed, 0)).toBeUndefined();
		expect(sectionCount("waiting", failed, 0)).toBeUndefined();
	});
});
