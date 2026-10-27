import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MeteEvent } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateDirs } from "../../src/infrastructure/template-store.js";
import { engineHarness, reply } from "../helpers/engine.js";

// A writer whose draft an editor reviews before the lead approves it (ADR-136); with a revision
// limit of 0 any counted revise would block the task.
const PAIRED = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: paired, name: Paired, version: 1.0.0 }
pattern: single
roles:
  - { id: writer, name: Writer, goal: Write, tier: fast, capabilities: [] }
  - { id: editor, name: Editor, goal: Edit, tier: fast, capabilities: [] }
  - { id: lead, name: Lead, goal: Approve, tier: reasoning, capabilities: [] }
tasks:
  - { id: write, role: writer, title: Write it, review: { pair_with: editor }, approval: lead }
policies: { revision_limit: 0 }
`;

let root: string;
let templates: TemplateDirs;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mete-pair-"));
	templates = { builtIn: join(root, "templates"), workspace: root };
	await mkdir(templates.builtIn);
	await writeFile(join(templates.builtIn, "paired.yaml"), PAIRED);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe("pair review", () => {
	it("asks the editor first, takes its return without counting it, then asks the lead", async () => {
		const h = engineHarness({
			scripts: [
				reply("draft"),
				reply('{"decision":"revise","feedback":"cite sources"}'),
				reply("draft 2"),
				reply('{"decision":"approve"}'),
				reply('{"decision":"approve"}'),
			],
			templates,
		});
		const asked: MeteEvent[] = [];
		for (const p of ["review.*", "approval.*"] as const)
			h.bus.subscribe(p, (e) => asked.push(e));
		const r = await h.engine.start({ goal: "g", templateId: "paired" });
		if (!r.ok) throw new Error(r.error.message);
		await vi.waitFor(() => {
			const v = h.engine.status(r.value.runId);
			expect(v.ok && v.value[0]?.status).toBe("completed");
		});
		expect(asked.map((e) => [e.type, e.payload])).toEqual([
			["review.requested", { reviewerRoleId: "editor" }],
			[
				"review.completed",
				{
					reviewerRoleId: "editor",
					decision: "revise",
					feedback: "cite sources",
				},
			],
			["review.requested", { reviewerRoleId: "editor" }],
			["review.completed", { reviewerRoleId: "editor", decision: "approve" }],
			["approval.requested", { approver: "lead" }],
			["approval.resolved", { approver: "lead", decision: "approve" }],
		]);
		expect(String(h.requests[2]?.messages.at(-1)?.content)).toContain(
			"cite sources",
		);
	});
});
