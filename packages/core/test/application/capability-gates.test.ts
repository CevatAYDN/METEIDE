import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, type RunView } from "@mete/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateDirs } from "../../src/infrastructure/template-store.js";
import { engineHarness, reply, type Tool } from "../helpers/engine.js";

// ADR-120: a verify gate that names a capability calls it. The guardrail allows no repair, so a
// gate that spent one would block the task.
const gated = (verify: string) => `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: duo, name: Duo, version: 1.0.0 }
pattern: single
roles:
  - { id: dev, name: Dev, goal: Build, tier: coder, capabilities: [] }
tasks:
  - id: build
    role: dev
    title: Build
    verify: ${verify}
    guardrail: { schema: research-report@1, max_retries: 0 }
`;

const REPORT = JSON.stringify({
	title: "T",
	summary: "S",
	findings: [{ claim: "C", sourceIds: ["s1"] }],
	sources: [{ id: "s1", url: "https://example.com", title: "E" }],
});

let root: string;
let templates: TemplateDirs;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "mete-gates-"));
	templates = { builtIn: join(root, "templates"), workspace: root };
	await mkdir(templates.builtIn);
});
afterEach(() => rm(root, { recursive: true, force: true }));

type H = ReturnType<typeof engineHarness>;
const view = (h: H, runId: string): RunView | undefined => {
	const r = h.engine.status(runId);
	return r.ok ? r.value[0] : undefined;
};
const settled = (h: H, runId: string, status: string) =>
	vi.waitFor(() => expect(view(h, runId)?.status).toBe(status));
const run = async (
	verify: string,
	opts: Parameters<typeof engineHarness>[0],
) => {
	await writeFile(join(templates.builtIn, "duo.yaml"), gated(verify));
	const h = engineHarness({ ...opts, templates });
	const r = await h.engine.start({ goal: "a prototype", templateId: "duo" });
	if (!r.ok) throw new Error(r.error.message);
	return { h, runId: r.value.runId };
};
const gates = (h: H) =>
	h.events.filter((e) => e.type === "verify.completed").map((e) => e.payload);

describe("verify gates by capability", () => {
	it("call the capability with its args, or none, and pass on an ok answer", async () => {
		const inputs: unknown[] = [];
		const engine: Tool = async (input) => {
			inputs.push(input);
			return ok({ log: "done" });
		};
		const { h, runId } = await run(
			"[{ capability: gameengine.build@1 }, { capability: gameengine.importAsset@1, args: { file: a.png } }]",
			{
				scripts: [reply(REPORT)],
				tools: [
					["gameengine.build@1", engine],
					["gameengine.importAsset@1", engine],
				],
			},
		);
		await settled(h, runId, "completed");
		expect(inputs).toEqual([{}, { file: "a.png" }]);
		expect(gates(h)).toEqual([
			{ gate: "gameengine.build@1", ok: true, details: "" },
			{ gate: "gameengine.importAsset@1", ok: true, details: "" },
		]);
	});

	it("send an error back to the agent as a failed command, with no repair spent", async () => {
		let n = 0;
		const build: Tool = async () =>
			n++ === 0
				? {
						ok: false,
						error: { code: "io", message: "npm run build exited with 1" },
					}
				: ok({ log: "built" });
		const { h, runId } = await run("[{ capability: gameengine.build@1 }]", {
			scripts: [reply(REPORT)],
			tools: [["gameengine.build@1", build]],
		});
		await settled(h, runId, "completed");
		const feedback = String(h.requests[1]?.messages.at(-1)?.content);
		expect(feedback).toContain(
			"The verify gate `gameengine.build@1` failed: npm run build exited with 1",
		);
		expect(gates(h)).toEqual([
			{
				gate: "gameengine.build@1",
				ok: false,
				details: expect.stringContaining("exited with 1"),
			},
			{ gate: "gameengine.build@1", ok: true, details: "" },
		]);
	});

	it("pause the run when the policy asks, and call again on resume", async () => {
		let n = 0;
		const asks = { code: "approval_required", message: "asks", rule: "r" };
		const build: Tool = async () =>
			n++ === 0 ? { ok: false, error: asks } : ok({ log: "built" });
		const { h, runId } = await run("[{ capability: gameengine.build@1 }]", {
			scripts: [reply(REPORT)],
			tools: [["gameengine.build@1", build]],
		});
		await settled(h, runId, "paused");
		expect(view(h, runId)?.pauseReason).toBe("approval");
		h.engine.resume(runId);
		await settled(h, runId, "completed");
		expect(n).toBe(2);
		expect(gates(h)).toEqual([
			{ gate: "gameengine.build@1", ok: true, details: "" },
		]);
	});

	it("skip a capability no adapter provides with a warning, and run the next gate", async () => {
		const commands: unknown[] = [];
		const shell: Tool = async (input) => {
			commands.push(input);
			return ok({ exitCode: 0, stdout: "", stderr: "", timedOut: false });
		};
		const { h, runId } = await run(
			'[{ capability: gameengine.test@1 }, { run: "npm test" }]',
			{ scripts: [reply(REPORT)], tools: [["shell.exec@1", shell]] },
		);
		await settled(h, runId, "completed");
		expect(commands).toEqual([{ command: "npm test" }]);
		expect(gates(h)).toEqual([{ gate: "npm test", ok: true, details: "" }]);
		expect(h.logged).toContainEqual({
			level: "warn",
			msg: "verify gate skipped: no adapter provides its capability",
		});
	});
});
