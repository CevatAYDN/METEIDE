import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmChunk } from "@mete/contracts";
import { expect, vi } from "vitest";
import { engineHarness, reply, type Script } from "./engine.js";

/** A deliberately abort-ignoring stream, released only by the test. */
export const gatedStream = (chunks: readonly LlmChunk[]) => {
	let release = () => {};
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const script: Script = async function* () {
		const model = chunks.find((chunk) => chunk.type === "model");
		if (model) yield model;
		await gate;
		yield* chunks.filter((chunk) => chunk.type !== "model");
	};
	return { script, release };
};

export const gatedReply = (text: string) => gatedStream(reply(text, [], text));

const template = (extra: string) => `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: parallel, name: Parallel, version: 1.0.0 }
pattern: parallel_then_synthesize
roles:
  - { id: first, name: First, goal: Research first, tier: fast, capabilities: [] }
  - { id: second, name: Second, goal: Research second, tier: reasoning, capabilities: [] }
tasks:
  - { id: a, role: first, title: Task A }
  - { id: b, role: second, title: Task B }
  - { id: c, role: first, title: Task C }
  - { id: d, role: second, title: Task D, context: [a, b] }
${extra}
`;

/** A real engine/store with only gated fake models and an isolated template directory. */
export const schedulerHarness = async (options: {
	scripts: Script[];
	extra?: string;
	policy?: unknown;
	llm?: boolean;
	tools?: NonNullable<Parameters<typeof engineHarness>[0]["tools"]>;
	wrapStore?: NonNullable<Parameters<typeof engineHarness>[0]["wrapStore"]>;
	rewrite?: (source: string) => string;
	configure?: (harness: ReturnType<typeof engineHarness>) => void;
}) => {
	const root = await mkdtemp(join(tmpdir(), "mete-scheduler-"));
	const templates = { builtIn: join(root, "templates"), workspace: root };
	await mkdir(templates.builtIn);
	const source = template(options.extra ?? "");
	await writeFile(
		join(templates.builtIn, "parallel.yaml"),
		options.rewrite?.(source) ?? source,
	);
	const harness = engineHarness({ ...options, templates });
	options.configure?.(harness);
	const started = await harness.engine.start({
		goal: "independent research",
		templateId: "parallel",
	});
	if (!started.ok) throw new Error(started.error.message);
	const runId = started.value.runId;
	return {
		...harness,
		runId,
		templates,
		async cleanup() {
			await harness.stop();
			await rm(root, { recursive: true, force: true });
			harness.db.close();
		},
	};
};

export type SchedulerHarness = Awaited<ReturnType<typeof schedulerHarness>>;

export const stateOf = (h: SchedulerHarness) => h.store.load(h.runId)?.snapshot;
export const untilRequests = (h: SchedulerHarness, count: number) =>
	vi.waitFor(() => expect(h.requests).toHaveLength(count));
export const untilStatus = (h: SchedulerHarness, status: string) =>
	vi.waitFor(() => expect(stateOf(h)?.value).toBe(status));

export const errorReply = (code: "network" | "no_model"): LlmChunk[] => [
	{ type: "error", error: { code, message: code } },
];
