import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
	type ChatChunk,
	type ChatRequest,
	DAEMON_METHODS,
	type ToolAdapter,
	type WebSearchInput,
	type WebSearchOutput,
} from "@mete/contracts";
import type { Adapter } from "@mete/kernel";
import { afterEach, describe, expect, it } from "vitest";
import {
	createMessageConnection,
	ErrorCodes,
	type MessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";
import { daemonCommand } from "../src/application/daemon.js";
import { draftMember, jsonBlock } from "../src/application/member-draft.js";
import { type App, createApp } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	recordingIo,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// mete/member.draft (ADR-108): one member drafted from the user's idea — the model's answer parsed
// at the boundary, the web's pages offered as sources, and refusals that keep their code. The model
// is the scripted provider; no network, no real model.

let app: App | undefined;
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await app?.stop();
	app = undefined;
	await close?.();
	close = undefined;
});

const finish = {
	type: "finish",
	reason: "stop",
	usage: { prompt: 10, completion: 10 },
} as const;

const MEMBER =
	'{"goal":"Builds and keeps the service that serves the site.","backstory":"Has shipped small, fast services.","task":{"title":"Build the API"},"sources":[]}';

const FAKE_PAGE: WebSearchOutput["results"] = [
	{
		title: "What backend developers do",
		url: "https://example.com/backend",
		snippet: "APIs, data and deploys.",
	},
];

/** An app over a temp folder whose only provider answers the given script. */
const started = async (
	script: ChatChunk[][],
	// The draft's web search is bound to this fake's pages, so no test touches the network.
	pages: WebSearchOutput["results"] = [],
) => {
	const repo = await tempRepo({ "a.txt": "a\n" });
	close = repo.close;
	await mkdir(join(repo.workspaceDir, ".mete"), { recursive: true });
	await writeFile(
		join(repo.workspaceDir, ".mete", "bindings.yaml"),
		"web.search@1: [fake-search]\n",
	);
	const made = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		templatesDir: join(repo.globalDir, "no-templates"),
		logger: silent,
		secrets: memorySecrets(),
		providers: [scriptedProvider({ script })],
	});
	if (!made.ok) throw new Error(JSON.stringify(made.error));
	app = made.value;
	app.registry.provide("web.search@1", searchAdapter(pages));
	return { workspaceDir: repo.workspaceDir };
};

/** A web.search@1 adapter that answers one fixed page. */
const searchAdapter = (
	results: WebSearchOutput["results"],
): Adapter<ToolAdapter<WebSearchInput, WebSearchOutput>> => ({
	id: "fake-search",
	trust: "first-party",
	features: [],
	impl: {
		run: async () => ({ ok: true, value: { results } }),
	},
});

describe("jsonBlock", () => {
	it("takes the first balanced object, however the model talks around it", () => {
		expect(jsonBlock('Sure! {"goal":"g"} hope it helps')).toBe('{"goal":"g"}');
		expect(jsonBlock('{"a":{"b":1}} tail')).toBe('{"a":{"b":1}}');
		expect(jsonBlock("no object")).toBeUndefined();
	});
});

describe("draftMember", () => {
	it("drafts a member and names the page the web gave", async () => {
		const seen: ChatRequest[] = [];
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		await mkdir(join(repo.workspaceDir, ".mete"), { recursive: true });
		await writeFile(
			join(repo.workspaceDir, ".mete", "bindings.yaml"),
			"web.search@1: [fake-search]\n",
		);
		const made = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			templatesDir: join(repo.globalDir, "no-templates"),
			logger: silent,
			secrets: memorySecrets(),
			providers: [
				scriptedProvider({
					script: [[{ type: "text", text: MEMBER }, finish]],
					seen,
				}),
			],
		});
		if (!made.ok) throw new Error(JSON.stringify(made.error));
		app = made.value;
		app.registry.provide("web.search@1", searchAdapter(FAKE_PAGE));
		const draft = await draftMember(app, "backend developer", "en");
		expect(draft.ok).toBe(true);
		if (!draft.ok) return;
		expect(draft.value.goal).toContain("service");
		expect(draft.value.task?.title).toBe("Build the API");
		// The model named no sources, so the draft offers the page the search gave.
		expect(draft.value.sources).toEqual(["https://example.com/backend"]);
		// The prompt carries the idea and the page's words, and asks for a JSON member.
		const prompt = seen[0]?.messages[0]?.content ?? "";
		expect(prompt).toContain("backend developer");
		expect(prompt).toContain("APIs, data and deploys");
	});

	it("drafts without the web when no search adapter answers", async () => {
		await started([[{ type: "text", text: MEMBER }, finish]]);
		if (!app) throw new Error("no app");
		const draft = await draftMember(
			app,
			"backend developer",
			"tr",
			"a bakery site",
		);
		expect(draft.ok).toBe(true);
		if (draft.ok) expect(draft.value.sources).toEqual([]);
	});

	it("refuses with bad_answer when the model does not answer a member", async () => {
		await started([
			[{ type: "text", text: "I cannot help with that." }, finish],
		]);
		if (!app) throw new Error("no app");
		const draft = await draftMember(app, "backend developer", "en");
		expect(draft).toEqual({
			ok: false,
			error: {
				code: "bad_answer",
				message: "the model's answer was not a drafted member",
			},
		});
	});

	it("refuses with no_model when no provider is ready", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		await mkdir(join(repo.workspaceDir, ".mete"), { recursive: true });
		await writeFile(
			join(repo.workspaceDir, ".mete", "bindings.yaml"),
			"web.search@1: [fake-search]\n",
		);
		const made = await createApp({
			workspaceDir: repo.workspaceDir,
			globalDir: repo.globalDir,
			templatesDir: join(repo.globalDir, "no-templates"),
			logger: silent,
			secrets: memorySecrets(),
			providers: [],
		});
		if (!made.ok) throw new Error(JSON.stringify(made.error));
		app = made.value;
		app.registry.provide("web.search@1", searchAdapter([]));
		const draft = await draftMember(app, "backend developer", "en");
		expect(draft.ok).toBe(false);
		if (!draft.ok) expect(draft.error.code).toBe("no_model");
	});
});

describe("the daemon serves mete/member.draft", () => {
	it("answers a draft and refuses params that are not an idea", async () => {
		const { workspaceDir } = await started([
			[{ type: "text", text: MEMBER }, finish],
		]);
		const [toDaemon, toClient] = [new PassThrough(), new PassThrough()];
		if (!app) throw new Error("no app");
		const serving = daemonCommand(app, recordingIo().io, workspaceDir, {
			input: toDaemon,
			output: toClient,
		});
		const conn: MessageConnection = createMessageConnection(
			new StreamMessageReader(toClient),
			new StreamMessageWriter(toDaemon),
		);
		conn.listen();
		const draft = await conn.sendRequest(DAEMON_METHODS.memberDraft, {
			idea: "backend developer",
			language: "en",
		});
		expect(draft).toMatchObject({ goal: expect.stringContaining("service") });
		await expect(
			conn.sendRequest(DAEMON_METHODS.memberDraft, { idea: "" }),
		).rejects.toMatchObject({ code: ErrorCodes.InvalidParams });
		toDaemon.end();
		await serving;
	});
});
