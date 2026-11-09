import { err, ok, type RunSkillsReadResult } from "@mete/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { createRunSkills } from "../src/application/run-skills.js";
import { RunSkills } from "../src/application/run-skills-view.js";
import type { MeteDaemonService } from "../src/domain/status-service.js";

const runId = "00000000-0000-4000-8000-000000000001";
const contextId = "00000000-0000-4000-8000-000000000002";
const owner = { runId, contextId };
const summary = (status: "selected" | "blocked"): RunSkillsReadResult => ({
	kind: "summary",
	runId,
	policy: { mode: "auto", roles: [] },
	contexts: [
		{
			owner,
			roleId: "agent",
			policy: { mode: "auto", selected: [] },
			status,
			loaded: [],
			...(status === "blocked" ? { block: { code: "revoked" as const } } : {}),
		},
	],
});
type Fetch = MeteDaemonService["runSkillsRead"];
const setup = (fetch: Fetch) => {
	let shown = { dir: "/w", runId, goal: "g" };
	const skills = createRunSkills({
		fetch: () => fetch,
		shown: () => shown,
		onChange: () => {},
	});
	return {
		skills,
		shown: () => shown,
		move: () => {
			shown = { ...shown, runId: "other" };
		},
	};
};

it("reads the shown run's metadata and treats a transport or mismatched reply as failure", async () => {
	const fetch = vi.fn<Fetch>(async () => ok(ok(summary("selected"))));
	const t = setup(fetch);
	await t.skills.show(t.shown());
	expect(fetch).toHaveBeenCalledWith("/w", { runId });
	expect(t.skills.state.phase).toBe("ready");
	fetch.mockResolvedValue(err({ code: "stopped", detail: "" }));
	await t.skills.refresh();
	expect(t.skills.state).toEqual({ phase: "failed" });
	fetch.mockResolvedValue(ok(ok({ kind: "legacy", runId: "another" })));
	await t.skills.refresh();
	expect(t.skills.state.phase).toBe("failed");
});

it("drops a late summary after navigation", async () => {
	let resolve!: (r: Awaited<ReturnType<Fetch>>) => void;
	const t = setup(() => new Promise((yes) => (resolve = yes)));
	const loading = t.skills.show(t.shown());
	t.move();
	t.skills.clear();
	resolve(ok(ok(summary("selected"))));
	await loading;
	expect(t.skills.state).toEqual({ phase: "idle" });
});

it("requests bodies only for one expanded context and reports its failure", async () => {
	const fetch = vi.fn<Fetch>(async () => ok(ok(summary("selected"))));
	const t = setup(fetch);
	await t.skills.show(t.shown());
	fetch.mockResolvedValue(err({ code: "stopped", detail: "" }));
	await t.skills.expand(contextId);
	expect(fetch).toHaveBeenLastCalledWith("/w", { runId, contextId });
	expect(t.skills.state.detailFailed).toBe(contextId);
});

it("shows typed block codes and never claims model use", () => {
	const html = renderToStaticMarkup(
		createElement(RunSkills, {
			state: { phase: "ready", result: summary("blocked") as never },
			onRetry: () => {},
			onExpand: () => {},
		}),
	);
	expect(html).toContain("Blocked: revoked");
	expect(html).toContain("does not prove the model followed it");
	const legacy = renderToStaticMarkup(
		createElement(RunSkills, {
			state: { phase: "ready", result: { kind: "legacy", runId } },
			onRetry: () => {},
			onExpand: () => {},
		}),
	);
	expect(legacy).toBe("");
});
