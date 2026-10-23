import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunView } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateDirs } from "../../src/infrastructure/template-store.js";
import { engineHarness, reply } from "../helpers/engine.js";

// spawns through the engine (docs/08, ADR-057): a project manager's approved task-list@1 becomes
// tasks of the run, each announced and run in list order with its acceptance in its opening.

const STUDIO = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: studio, name: Studio, version: 1.0.0 }
pattern: hierarchical
roles:
  - { id: pm, name: PM, goal: Split work, tier: reasoning, capabilities: [] }
  - { id: developer, name: Developer, goal: Build, tier: coder, capabilities: [] }
  - { id: lead, name: Lead, goal: Approve, tier: reasoning, capabilities: [] }
tasks:
  - { id: plan_tasks, role: pm, title: Split the design into tasks, expected_output: "artifact:task-list@1", approval: lead, spawns: true }
spawn_defaults:
  developer: { approval: lead }
`;

const entry = (id: string, role: string, dependsOn?: string[]) => ({
	id,
	role,
	title: `Build ${id}`,
	acceptance: [`${id} works`],
	...(dependsOn ? { dependsOn } : {}),
});
const list = (...tasks: ReturnType<typeof entry>[]) =>
	JSON.stringify({ tasks });
const APPROVE = reply('{"decision":"approve"}');

let root: string;
let templates: TemplateDirs;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mete-spawn-"));
	templates = { builtIn: join(root, "templates"), workspace: root };
	await mkdir(templates.builtIn);
	await writeFile(join(templates.builtIn, "studio.yaml"), STUDIO);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("spawned tasks in a run (ADR-057)", () => {
	it("repairs a list that names an unknown role, then runs its tasks after approval", async () => {
		const h = engineHarness({
			scripts: [
				reply(list(entry("art", "artist"))),
				reply(
					list(
						entry("canvas", "developer"),
						entry("ball", "developer", ["canvas"]),
					),
				),
				APPROVE,
				reply("canvas done"),
				APPROVE,
				reply("ball done"),
				APPROVE,
			],
			templates,
		});
		const r = await h.engine.start({
			goal: "a pong game",
			templateId: "studio",
		});
		if (!r.ok) throw new Error(r.error.message);
		const view = (): RunView | undefined => {
			const v = h.engine.status(r.value.runId);
			return v.ok ? v.value[0] : undefined;
		};
		await vi.waitFor(() => expect(view()?.status).toBe("completed"));
		// The repair names the template's rule.
		const repair = h.requests[1]?.messages.at(-1)?.content;
		expect(String(repair)).toContain("artist is not a role of the template");
		// The plan, then each spawned task, announced once.
		const created = h.events.filter((e) => e.type === "task.created");
		expect(created.map((e) => e.payload)).toMatchObject([
			{ title: "Split the design into tasks", roleId: "pm" },
			{ title: "Build canvas", roleId: "developer" },
			{ title: "Build ball", roleId: "developer" },
		]);
		const [plan, canvas, ball] = created.map((e) => e.taskId);
		expect(created[1]?.payload).toMatchObject({ dependsOn: [plan] });
		expect(created[2]?.payload).toMatchObject({ dependsOn: [plan, canvas] });
		expect(ball).toBeDefined();
		// Each spawned task opens with its acceptance, and runs in list order.
		const opening = h.requests[3]?.messages[1]?.content;
		expect(String(opening)).toContain("Your task: Build canvas");
		expect(String(opening)).toContain("Acceptance:\n- canvas works");
		expect(h.events.at(-1)?.payload).toEqual({ summary: "ball done" });
	});
});
