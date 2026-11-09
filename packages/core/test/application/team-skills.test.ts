import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatMessage, LlmChatRequest, LlmChunk } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateDirs } from "../../src/infrastructure/template-store.js";
import { engineHarness, reply } from "../helpers/engine.js";
import { scriptedSkills } from "../helpers/skills.js";

const DUO = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: duo, name: Duo, version: 1.0.0 }
pattern: pipeline
roles:
  - { id: finder, name: Finder, goal: Find facts, tier: reasoning, capabilities: [] }
  - { id: writer, name: Writer, goal: Write, tier: fast, capabilities: [] }
tasks:
  - { id: find, role: finder, title: Find facts }
  - { id: write, role: writer, title: Write it up, context: [find] }
budget: { cloud_requests: 8 }
`;
const BODY =
	"---\nname: finder-skill\ndescription: d\n---\nFINDER-ONLY-GUIDANCE";
const version = {
	sourceId: "a".repeat(64),
	sha256: "b".repeat(64),
	revision: 1,
};

type H = ReturnType<typeof engineHarness>;
let root: string;
let templates: TemplateDirs;
const open: H[] = [];
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mete-team-skills-"));
	templates = { builtIn: join(root, "templates"), workspace: root };
	await mkdir(templates.builtIn);
	await writeFile(join(templates.builtIn, "duo.yaml"), DUO);
});
afterEach(async () => {
	for (const h of open.splice(0)) {
		await h.stop();
		h.db.close();
	}
	await rm(root, { recursive: true, force: true });
});

const userText = (m: ChatMessage | undefined) =>
	m?.role === "user" && typeof m.content === "string" ? m.content : "";
const pinned = (req: LlmChatRequest | undefined) =>
	(req?.messages ?? []).some((m) => userText(m).includes("<approved-skills>"));

describe("team task attempt skill contexts", () => {
	it("pins a load to its task attempt only, never to another role", async () => {
		const gate = Promise.withResolvers<void>();
		const held = async function* (
			_r: LlmChatRequest,
			signal: AbortSignal,
		): AsyncGenerator<LlmChunk> {
			await Promise.race([
				gate.promise,
				new Promise((resolve) => signal.addEventListener("abort", resolve)),
			]);
			yield { type: "error", error: { code: "aborted", message: "x" } };
		};
		const h = engineHarness({
			scripts: [held, reply("found"), reply("written"), reply("done")],
			templates,
		});
		open.push(h);
		scriptedSkills(h.registry, h.skillLoadAdmission, BODY);
		const started = await h.runSkills.start({
			goal: "facts",
			templateId: "duo",
			skills: { mode: "auto", roles: [] },
		});
		if (!started.ok) throw new Error(started.error.message);
		const { runId } = started.value;
		await vi.waitFor(() => expect(h.requests).toHaveLength(1));
		const context = h.store.load(runId)?.snapshot.context;
		const findId = context?.team?.tasks.find?.id;
		if (!findId) throw new Error("no find task");
		const loaded = await h.loadSkill(runId, {
			owner: {
				runId,
				contextId: "00000000-0000-4000-8000-0000000000aa",
				taskId: findId,
				attemptId: findId,
			},
			roleId: "finder",
			version,
			origin: "model",
		});
		if (!loaded.ok) throw new Error(loaded.error.code);
		await h.engine.pause(runId);
		gate.resolve();
		expect((await h.engine.resume(runId)).ok).toBe(true);
		await vi.waitFor(() => expect(h.requests.length).toBeGreaterThanOrEqual(3));
		const finder = h.requests[1];
		const writer = h.requests.find(
			(r, i) => i > 1 && JSON.stringify(r.messages).includes("Write it up"),
		);
		expect(pinned(finder)).toBe(true);
		expect(JSON.stringify(finder?.messages)).toContain("FINDER-ONLY-GUIDANCE");
		expect(writer).toBeDefined();
		expect(pinned(writer)).toBe(false);
		const saved = h.store.load(runId)?.snapshot.context.skills?.contexts;
		expect(saved).toHaveLength(1);
		expect(saved?.[0]).toMatchObject({
			roleId: "finder",
			owner: { taskId: findId, attemptId: findId },
		});
	});
});
