import { randomUUID } from "node:crypto";
import {
	type ChatMessage,
	type LlmChatRequest,
	ok,
	type SkillRuntimeCatalog,
} from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { engineHarness, reply } from "../helpers/engine.js";
import { scriptedSkills } from "../helpers/skills.js";

type H = ReturnType<typeof engineHarness>;
const open: H[] = [];
afterEach(async () => {
	for (const h of open.splice(0)) {
		await h.stop();
		h.db.close();
	}
});
const BODY = "---\nname: review\ndescription: d\n---\nUSE-THE-CHECKLIST";
const version = {
	sourceId: "a".repeat(64),
	sha256: "b".repeat(64),
	revision: 1,
};
const catalog: SkillRuntimeCatalog = {
	status: "ready",
	entries: [
		{
			version,
			source: {
				sourceId: version.sourceId,
				scope: "workspace",
				path: "r/SKILL.md",
			},
			name: "review",
			description: "Review checklist",
		},
	],
	diagnostics: [],
};
const toolNames = (r: LlmChatRequest | undefined) =>
	(r?.tools ?? []).map(({ name }) => name);
const text = (r: LlmChatRequest | undefined) => JSON.stringify(r?.messages);
const lastTool = (r: LlmChatRequest | undefined) =>
	r?.messages.findLast(
		(m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool",
	);

const run = async (
	args: unknown,
	mode: "auto" | "manual" = "auto",
	ready = catalog,
) => {
	const h = engineHarness({
		scripts: [reply("", [{ name: "skill_load", args }]), reply("done")],
	});
	open.push(h);
	const skills = scriptedSkills(h.registry, h.skillLoadAdmission, BODY);
	skills.catalog.mockResolvedValue(ok(ready));
	const started = await h.threadSkills.start({
		requestId: randomUUID(),
		goal: "hello",
		skills: { mode, selected: [] },
	});
	if (!started.ok) throw new Error(started.error.message);
	await vi.waitFor(() =>
		expect(h.engine.status(started.value.runId)).toMatchObject({
			value: [{ status: "completed" }],
		}),
	);
	return { h, skills, runId: started.value.runId };
};

describe("skill_load model tool", () => {
	it("loads a catalog version for the model and pins it on the next request", async () => {
		const { h, skills, runId } = await run(version);
		expect(toolNames(h.requests[0])).toContain("skill_load");
		expect(text(h.requests[0])).toContain("<skill-catalog>");
		expect(text(h.requests[0])).not.toContain("USE-THE-CHECKLIST");
		expect(skills.load).toHaveBeenCalledWith(
			expect.objectContaining({ origin: "model", version }),
			expect.any(AbortSignal),
		);
		expect(text(h.requests[1])).toContain("USE-THE-CHECKLIST");
		expect(lastTool(h.requests[1])?.content).toContain('"receiptId"');
		expect(lastTool(h.requests[1])?.content).not.toContain("USE-THE-CHECKLIST");
		expect(skills.catalog).toHaveBeenCalledOnce();
		const saved = h.store.load(runId)?.snapshot.context.skills?.contexts[0];
		expect(saved?.snapshots.map((x) => x.origin)).toEqual(["model"]);
	});

	it("refuses a version outside the catalog without asking security", async () => {
		const { h, skills } = await run({ ...version, revision: 2 });
		expect(skills.load).not.toHaveBeenCalled();
		expect(lastTool(h.requests[1])?.content).toContain('"bad_input"');
	});

	it("is not offered in manual mode or with an empty catalog", async () => {
		const manual = await run(version, "manual");
		expect(toolNames(manual.h.requests[0])).not.toContain("skill_load");
		expect(manual.skills.catalog).not.toHaveBeenCalled();
		const empty = await run(version, "auto", {
			status: "ready",
			entries: [],
			diagnostics: [],
		});
		expect(toolNames(empty.h.requests[0])).not.toContain("skill_load");
	});
});
