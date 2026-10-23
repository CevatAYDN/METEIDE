import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type ChatChunk, ResearchReportSchema } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { eventsCommand, runCommand } from "../src/application/commands.js";
import { createApp } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// The Phase 2 exit gate (ROADMAP.md): the built-in research template turns a topic into a cited
// report through every real module; the models, Tavily and the web page are scripted fakes.

const PAGE = "https://example.org/free-models";

const REPORT = JSON.stringify({
	title: "Free model providers",
	summary: "OpenRouter and NVIDIA offer free chat models.",
	findings: [
		{ claim: "OpenRouter lists free models.", sourceIds: ["s1"] },
		{ claim: "NVIDIA hosts free endpoints.", sourceIds: ["s1"] },
	],
	sources: [{ id: "s1", url: PAGE, title: "Free models" }],
});

const finish = (reason: "stop" | "tool-calls"): ChatChunk => ({
	type: "finish",
	reason,
	usage: { prompt: 10, completion: 5 },
});
const say = (text: string): ChatChunk[] => [
	{ type: "text", text },
	finish("stop"),
];
const call = (name: string, args: unknown): ChatChunk[] => [
	{ type: "tool-call", id: `c-${name}`, name, args },
	finish("tool-calls"),
];
const approve = say('{"decision":"approve"}');
const revise = say('{"decision":"revise","feedback":"cite a second source"}');

// Tavily's POST /search and one article page; anything else is a 404.
const web: typeof fetch = async (input, init) => {
	const url = String(input);
	if (url === "https://api.tavily.com/search" && init?.method === "POST")
		return Response.json({
			results: [{ title: "Free models", url: PAGE, content: "A list" }],
		});
	if (url === PAGE)
		return new Response(
			"<html><head><title>Free models</title></head><body><article><p>OpenRouter lists free models, and NVIDIA hosts free endpoints for everyone.</p></article></body></html>",
			{ headers: { "content-type": "text/html" } },
		);
	return new Response("", { status: 404 });
};

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const setup = async (script: ChatChunk[][]) => {
	const repo = await tempRepo({ "README.md": "# notes\n" });
	const app = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		logger: silent,
		secrets: memorySecrets({ "search/tavily/apiKey": "tvly-test" }),
		providers: [scriptedProvider({ script })],
		fetch: web,
	});
	if (!app.ok) throw new Error(JSON.stringify(app.error));
	close = async () => {
		await app.value.stop();
		await repo.close();
	};
	return { repo, app: app.value };
};

const runIdOf = (out: readonly string[]) =>
	/^run (\S+) started$/.exec(out[0] ?? "")?.[1] ?? "";

describe("the research template", () => {
	it("turns a topic into a cited report that the lead approves", async () => {
		const { repo, app } = await setup([
			call("web_search", { query: "free model providers" }),
			call("web_fetch", { url: PAGE }),
			say(`Notes: OpenRouter lists free models (${PAGE}).`),
			say(`Notes: NVIDIA hosts free endpoints (${PAGE}).`),
			say(REPORT),
			approve,
		]);
		const t = recordingIo();
		const goal = "free model providers";
		expect(await runCommand(app, t.io, { goal, templateId: "research" })).toBe(
			0,
		);
		const runId = runIdOf(t.out);
		const file = join(
			repo.workspaceDir,
			".mete",
			"artifacts",
			runId,
			"report.json",
		);
		const report = ResearchReportSchema.parse(
			JSON.parse(await readFile(file, "utf8")),
		);
		expect(report.sources[0]?.url).toBe(PAGE);
		// The built-in Exa server answers 404 here, so the search falls back to Tavily.
		expect(t.out.filter((l) => l === "tool  web.search@1")).toHaveLength(2);
		expect(t.out).toEqual(
			expect.arrayContaining([
				"tool  web.search@1",
				"tool  web.fetch@1",
				"lead approved: Write the cited research report",
				`completed\n${REPORT}`,
			]),
		);
	});

	it("blocks the report past the revision limit, and the human sends it back", async () => {
		const { app } = await setup([
			say("Notes A"),
			say("Notes B"),
			...[1, 2, 3, 4].flatMap(() => [say(REPORT), revise]),
			say(REPORT),
			approve,
		]);
		const t = recordingIo();
		const goal = "free model providers";
		expect(await runCommand(app, t.io, { goal, templateId: "research" })).toBe(
			2,
		);
		expect(t.out).toContain("task  Write the cited research report: blocked");
		expect(t.err[0]).toBe("A team task waits for you. Approve it with:");
		const after = recordingIo();
		const input = {
			taskId: "report",
			decision: "revise" as const,
			feedback: "use two sources",
		};
		const runId = runIdOf(t.out);
		expect(await runCommand(app, after.io, { approve: runId, input })).toBe(0);
		expect(after.out.at(-1)).toBe(`completed\n${REPORT}`);
		const history = recordingIo();
		expect(eventsCommand(app, history.io, runId)).toBe(0);
		// --json prints what mete/events answers: the events and the count that no longer parse.
		const json = recordingIo();
		expect(eventsCommand(app, json.io, runId, true)).toBe(0);
		const parsed = JSON.parse(json.out.join("\n"));
		expect(parsed.unreadable).toBe(0);
		expect(parsed.events).toHaveLength(history.out.length);
		// When, what, which module, which task: one line answers each.
		const blocked = history.out.find((l) => l.endsWith(": blocked")) ?? "";
		expect(blocked).toMatch(/^\d{4}-\d\d-\d\dT\S+Z {2}task\.status\.changed /);
		expect(blocked).toContain(
			" core-engine  task=Write the cited research report",
		);
		expect(
			eventsCommand(
				app,
				recordingIo().io,
				"00000000-0000-4000-8000-000000000000",
			),
		).toBe(1);
	});
});
