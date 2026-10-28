import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type RunView, type ToolContext } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateDirs } from "../../src/infrastructure/template-store.js";
import { engineHarness, reply, type Tool } from "../helpers/engine.js";

// docs/08, step 8 (ADR-145): a task with memory.write_lessons, once approved, gets one more turn
// without tools for a lesson@1, which the core writes through vault.write@1; a lesson that cannot
// be had is skipped with a warning and the run goes on.
const TEAM = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: learner, name: Learner, version: 1.0.0 }
pattern: single
roles:
  - { id: dev, name: Dev, goal: Build, tier: coder, capabilities: [] }
tasks:
  - { id: build, role: dev, title: Build, memory: { write_lessons: true } }
`;

const LESSON = {
	title: "Check the port first",
	lesson: "The dev server failed until the port was free.",
	evidence: "EADDRINUSE on 5173",
	tags: ["dev-server"],
};

let root: string;
let templates: TemplateDirs;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mete-lessons-"));
	templates = { builtIn: join(root, "templates"), workspace: root };
	await mkdir(templates.builtIn);
	await writeFile(join(templates.builtIn, "learner.yaml"), TEAM);
});
afterEach(() => rm(root, { recursive: true, force: true }));

type H = ReturnType<typeof engineHarness>;
const view = (h: H, runId: string): RunView | undefined => {
	const r = h.engine.status(runId);
	return r.ok ? r.value[0] : undefined;
};
const run = async (
	opts: Omit<Parameters<typeof engineHarness>[0], "templates">,
) => {
	const h = engineHarness({ ...opts, templates });
	const r = await h.engine.start({ goal: "a page", templateId: "learner" });
	if (!r.ok) throw new Error(r.error.message);
	await vi.waitFor(() =>
		expect(view(h, r.value.runId)?.status).toBe("completed"),
	);
	return { h, runId: r.value.runId };
};
const recording = () => {
	const calls: { input: unknown; ctx: ToolContext }[] = [];
	const tool: Tool = async (input, ctx) => {
		calls.push({ input, ctx });
		return ok({
			path: ".mete/knowledge/lessons/check-the-port-first.md",
			created: true,
		});
	};
	return { calls, tool };
};
const skipped = (h: H) =>
	h.logged.filter(
		(l) => l.level === "warn" && l.msg.startsWith("lesson skipped"),
	);

describe("lessons after approval", () => {
	it("asks once without tools and writes the lesson through vault.write@1", async () => {
		const vault = recording();
		const { h, runId } = await run({
			scripts: [reply("Built it."), reply(JSON.stringify(LESSON))],
			tools: [["vault.write@1", vault.tool]],
		});
		expect(h.requests).toHaveLength(2);
		expect(h.requests[1]?.tools).toBeUndefined();
		expect(h.requests[1]?.messages.at(-1)?.role).toBe("user");
		expect(vault.calls).toHaveLength(1);
		expect(vault.calls[0]?.input).toEqual({
			type: "lesson",
			title: LESSON.title,
			body: `${LESSON.lesson}\n\nEvidence: ${LESSON.evidence}`,
			tags: LESSON.tags,
		});
		expect(vault.calls[0]?.ctx.runId).toBe(runId);
		expect(skipped(h)).toEqual([]);
	});

	it("skips a reply that is no lesson, without asking again", async () => {
		const vault = recording();
		const { h } = await run({
			scripts: [reply("Built it."), reply("I learned a lot.")],
			tools: [["vault.write@1", vault.tool]],
		});
		expect(h.requests).toHaveLength(2);
		expect(vault.calls).toEqual([]);
		expect(skipped(h)).toHaveLength(1);
	});

	it("asks nothing when no vault is active", async () => {
		const { h } = await run({ scripts: [reply("Built it.")] });
		expect(h.requests).toHaveLength(1);
		expect(skipped(h)).toHaveLength(1);
	});

	it("skips a write the policy asks about, and never pauses for it", async () => {
		const asked: Tool = async () =>
			err({ code: "approval_required", message: "asks", rule: "autonomy:1" });
		const { h, runId } = await run({
			scripts: [reply("Built it."), reply(JSON.stringify(LESSON))],
			tools: [["vault.write@1", asked]],
		});
		expect(
			h.events.some((e) => e.runId === runId && e.type === "run.paused"),
		).toBe(false);
		expect(skipped(h)).toHaveLength(1);
	});

	it("asks nothing once the budget's cloud requests are spent", async () => {
		const vault = recording();
		const { h } = await run({
			scripts: [reply("Built it."), reply(JSON.stringify(LESSON))],
			tools: [["vault.write@1", vault.tool]],
			policy: { budget: { cloud_requests_per_run: 1 } },
		});
		expect(h.requests).toHaveLength(1);
		expect(vault.calls).toEqual([]);
		expect(skipped(h)).toHaveLength(1);
	});
});
