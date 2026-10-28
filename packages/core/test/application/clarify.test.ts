import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateDirs } from "../../src/infrastructure/template-store.js";
import { engineHarness, reply, type Script } from "../helpers/engine.js";

// A writer who asks before it works (docs/08, step 1; ADR-142): a researcher answers, or the human.
const ASKING = (by: string) => `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: asking, name: Asking, version: 1.0.0 }
pattern: single
roles:
  - { id: writer, name: Writer, goal: Write, tier: fast, capabilities: [fs.read@1] }
  - { id: helper, name: Researcher, goal: Find answers, tier: fast, capabilities: [fs.read@1] }
tasks:
  - { id: write, role: writer, title: Write it, before_start: { clarify_with: ${by} } }
`;

let root: string;
let templates: TemplateDirs;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mete-clarify-"));
	templates = { builtIn: join(root, "templates"), workspace: root };
	await mkdir(templates.builtIn);
});
afterEach(() => rm(root, { recursive: true, force: true }));

const run = async (by: string, scripts: Script[]) => {
	await writeFile(join(templates.builtIn, "asking.yaml"), ASKING(by));
	const h = engineHarness({
		scripts,
		templates,
		tools: [["fs.read@1", async () => ok({ content: "x" })]],
	});
	const r = await h.engine.start({ goal: "a page", templateId: "asking" });
	if (!r.ok) throw new Error(r.error.message);
	const settled = (status: string) =>
		vi.waitFor(() => {
			const v = h.engine.status(r.value.runId);
			expect(v.ok && v.value[0]?.status).toBe(status);
		});
	return { h, runId: r.value.runId, settled };
};

const asked = (h: ReturnType<typeof engineHarness>) =>
	h.events.filter((e) =>
		["task.clarification.requested", "agent.message.sent"].includes(e.type),
	);

describe("clarify before the work (ADR-142)", () => {
	it("asks its questions with no tools, has the researcher answer them with its own, then works with the answer", async () => {
		const { h, settled } = await run("helper", [
			reply("Which city?"),
			reply("Ankara. The brief names it."),
			reply("done"),
		]);
		await settled("completed");
		const [ask, answer, work] = h.requests;
		expect(ask?.tools).toBeUndefined();
		expect(String(ask?.messages.at(-1)?.content)).toContain("Researcher");
		expect(answer?.tools?.length).toBeGreaterThan(0);
		expect(String(answer?.messages[0]?.content)).toContain(
			"You are Researcher",
		);
		expect(String(answer?.messages.at(-1)?.content)).toContain("Which city?");
		expect(work?.tools?.length).toBeGreaterThan(0);
		expect(work?.messages.at(-2)).toMatchObject({
			role: "assistant",
			content: "Which city?",
		});
		expect(work?.messages.at(-1)).toEqual({
			role: "user",
			content: "Answers from Researcher: Ankara. The brief names it.",
		});
		const writer = h.events.find((e) => e.type === "task.assigned");
		const agentId =
			writer?.type === "task.assigned" ? writer.payload.agentId : "";
		expect(asked(h).map((e) => [e.type, e.payload])).toEqual([
			[
				"task.clarification.requested",
				{ toRoleId: "helper", question: "Which city?" },
			],
			[
				"agent.message.sent",
				expect.objectContaining({
					to: agentId,
					kind: "answer",
					summary: "Ankara.",
				}),
			],
		]);
	});

	it("blocks the task for the human's answer, which the writer then works with", async () => {
		const { h, runId, settled } = await run("human", [
			reply("Which city?"),
			reply("done"),
		]);
		await settled("paused");
		expect(asked(h).map((e) => e.payload)).toEqual([
			{ toRoleId: "human", question: "Which city?" },
		]);
		const status = h.events.filter((e) => e.type === "task.status.changed");
		expect(status.at(-1)?.payload).toEqual({
			from: "in_progress",
			to: "blocked",
		});
		const r = await h.engine.approve(runId, {
			decision: "revise",
			feedback: "Ankara",
		});
		expect(r.ok).toBe(true);
		await settled("completed");
		expect(h.requests[1]?.tools?.length).toBeGreaterThan(0);
		expect(h.requests[1]?.messages.at(-1)).toEqual({
			role: "user",
			content: "The human answers your questions: Ankara",
		});
	});

	it("goes on with the task when it has no questions", async () => {
		const { h, settled } = await run("helper", [reply("None."), reply("done")]);
		await settled("completed");
		expect(asked(h)).toEqual([]);
		expect(h.requests).toHaveLength(2);
		expect(h.requests[1]?.tools?.length).toBeGreaterThan(0);
		expect(h.requests[1]?.messages.at(-1)).toEqual({
			role: "user",
			content: "Go on with the task.",
		});
	});
});
