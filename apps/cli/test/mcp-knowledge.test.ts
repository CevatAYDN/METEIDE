import { generateKeyPairSync } from "node:crypto";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import {
	type ChatRequest,
	DaemonKnowledgeSearchResultSchema,
	type KnowledgeSearchInput,
	type KnowledgeSearchOutput,
	type ToolAdapter,
} from "@mete/contracts";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { type App, createApp, engineOf } from "../src/infrastructure/app.js";
import {
	memorySecrets,
	scriptedProvider,
	silent,
	tempRepo,
} from "./helpers.js";

// ADR-188: the advertised tool reaches real workspace search, fs and security.
// Chat is scripted without embedding models; every outbound fetch fails offline.
const PATH = "lessons/collision-tests.md";
const BODY =
	"The player fell through the floor until a collision test caught it.";
const NOTE = `---\ntype: lesson\ntitle: Write collision tests early\n---\n\n# Why\n\n${BODY}\n`;

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	const cleanup = close;
	close = undefined;
	await cleanup?.();
});

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) => {
	expect(result.content).toHaveLength(1);
	const block = result.content[0];
	if (block?.type !== "text") throw new Error("Expected one MCP text block");
	return block.text;
};

const served = async () => {
	const repo = await tempRepo({
		"a.txt": "a\n",
		".meteignore": ".mete/knowledge/decisions/\n",
	});
	const client = new Client({ name: "knowledge-test", version: "0" });
	let app: App | undefined;
	close = async () => {
		try {
			await client.close();
		} finally {
			try {
				// Lifecycle shutdown closes the MCP server and knowledge module.
				await app?.stop();
			} finally {
				await repo.close();
			}
		}
	};
	const seen: ChatRequest[] = [];
	const network: string[] = [];
	const [mine, theirs] = InMemoryTransport.createLinkedPair();
	const started = await createApp({
		workspaceDir: repo.workspaceDir,
		globalDir: repo.globalDir,
		templatesDir: join(repo.globalDir, "no-templates"),
		logger: silent,
		secrets: memorySecrets(),
		providers: [scriptedProvider({ script: [], seen })],
		fetch: async (input) => {
			network.push(String(input));
			throw new Error("Unexpected network request in offline knowledge test");
		},
		serve: mine,
	});
	if (!started.ok) throw new Error(JSON.stringify(started.error));
	app = started.value;
	const engine = engineOf(app);
	if (!engine.ok) throw new Error(JSON.stringify(engine.error));
	const idle = async () => {
		expect(
			await started.value.embedChain(new AbortController().signal),
		).toEqual([]);
		expect(seen).toEqual([]);
		expect(network).toEqual([]);
		expect(engine.value.status()).toEqual({ ok: true, value: [] });
	};
	await idle();
	await client.connect(theirs);
	const { tools } = await client.listTools();
	expect(tools.map((tool) => tool.name)).toContain("mete_knowledge_search");
	const note = async (path: string, text: string) => {
		const file = join(repo.workspaceDir, ".mete", "knowledge", path);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, text, "utf8");
	};
	const call = async (query: string) => {
		const result = await client.callTool({
			name: "mete_knowledge_search",
			arguments: { query },
		});
		await idle();
		return result;
	};
	const search = async (query: string) => {
		const result = await call(query);
		expect(result.isError).not.toBe(true);
		const parsed = DaemonKnowledgeSearchResultSchema.parse(
			JSON.parse(textOf(result)),
		);
		expect(result.structuredContent).toEqual(parsed);
		return parsed;
	};
	const remove = (path: string) =>
		rm(join(repo.workspaceDir, ".mete", "knowledge", path));
	const ignore = (path: string) =>
		appendFile(
			join(repo.workspaceDir, ".meteignore"),
			`${posix.join(".mete", "knowledge", path)}\n`,
			"utf8",
		);
	return {
		note,
		search,
		call,
		remove,
		ignore,
		registry: started.value.registry,
	};
};

describe("mete_knowledge_search offline composition", {
	timeout: 30_000,
}, () => {
	it("returns a public workspace snippet, never private or ignored notes, and valid empty results", async () => {
		const s = await served();
		await s.note(PATH, NOTE);
		await s.note(
			"lessons/private.md",
			"---\ntype: lesson\ntitle: Private\nprivate: true\n---\n\ncollision classified\n",
		);
		await s.note(
			"decisions/ignored.md",
			"---\ntype: decision\ntitle: Ignored\n---\n\ncollision confidential\n",
		);
		expect(await s.search("collision")).toEqual({
			results: [
				{
					path: PATH,
					scope: "workspace",
					type: "lesson",
					title: "Write collision tests early",
					heading: "Why",
					snippet: BODY,
					sources: { keyword: 1 },
				},
			],
		});
		for (const query of ["spaceship", "classified", "confidential"])
			expect(await s.search(query)).toEqual({ results: [] });
	});

	it("preserves the real search adapter's bad_input refusal for a query without words", async () => {
		const s = await served();
		const result = await s.call("!!!");
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/^bad_input:/);
	});

	it("masks a complete CRLF private key in a native note title before MCP serialization", async () => {
		const s = await served();
		const pem = generateKeyPairSync("rsa", { modulusLength: 1024 })
			.privateKey.export({ type: "pkcs8", format: "pem" })
			.toString()
			.trim()
			.replaceAll("\n", "\r\n");
		const keyBody = pem.split("\r\n")[1] ?? "";
		expect(keyBody.length).toBeGreaterThan(40);
		// JSON quoting preserves CRLF in YAML; titles bypass the 40-token snippet limit.
		await s.note(
			PATH,
			`---\ntype: lesson\ntitle: ${JSON.stringify(pem)}\n---\n\ncollision\n`,
		);
		const native =
			s.registry.resolve<
				ToolAdapter<KnowledgeSearchInput, KnowledgeSearchOutput>
			>("knowledge.search@1");
		if (!native.ok) throw new Error(JSON.stringify(native.error));
		const before = await native.value[0].impl.run(
			{ query: "collision", scope: "workspace" },
			{ signal: new AbortController().signal },
		);
		if (!before.ok) throw new Error(JSON.stringify(before.error));
		const unmasked = DaemonKnowledgeSearchResultSchema.parse(before.value);
		expect(unmasked.results).toHaveLength(1);
		expect(unmasked.results[0]?.title).toBe(pem);

		const result = await s.call("collision");
		expect(result.isError).not.toBe(true);
		const text = textOf(result);
		const masked = DaemonKnowledgeSearchResultSchema.parse(JSON.parse(text));
		expect(result.structuredContent).toEqual(masked);
		expect(masked.results).toHaveLength(1);
		expect(masked.results[0]?.title).toMatch(/^\[SECRET:[a-f0-9]{8}\]$/);
		for (const output of [text, JSON.stringify(result.structuredContent)]) {
			expect(output).not.toContain(keyBody);
			expect(output).not.toContain(pem);
			expect(output).not.toContain(JSON.stringify(pem).slice(1, -1));
		}
	});

	it.each(["private", "deleted", "ignored"] as const)(
		"forgets an indexed note when it becomes %s before the next MCP search",
		async (change) => {
			const s = await served();
			await s.note(PATH, NOTE);
			expect((await s.search("collision")).results).toHaveLength(1);
			if (change === "private")
				await s.note(
					PATH,
					`---\ntype: lesson\ntitle: Write collision tests early\nprivate: true\n---\n\n# Why\n\n${BODY}\n`,
				);
			else if (change === "ignored") await s.ignore(PATH);
			else await s.remove(PATH);
			expect(await s.search("collision")).toEqual({ results: [] });
			expect(await s.search("floor")).toEqual({ results: [] });
		},
	);
});
