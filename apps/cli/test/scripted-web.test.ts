import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { searchKeyName } from "@mete/tools";
import { afterEach, describe, expect, it } from "vitest";
import { SCRIPTED_WEB_ENV } from "../src/defaults.js";
import {
	readWebScript,
	scriptedSecrets,
	scriptedWeb,
} from "../src/infrastructure/scripted-web.js";
import { main, webOf } from "../src/main.js";
import { recordingIo, silent, tempRepo } from "./helpers.js";

// The web half of the scripted app (docs/15, LLM replay; ADR-116): a JSON file answers the search and
// the pages, and the app's keys stay in memory, so a test reaches neither the network nor the
// developer's keychain.

const PAGE = "https://example.org/free-models";
const HTML =
	"<html><head><title>Free models</title></head><body><article><p>OpenRouter lists free models.</p></article></body></html>";
/** Tavily's endpoint, as the real adapter calls it (packages/tools/src/application/web-search.ts). */
const TAVILY = "https://api.tavily.com/search";
/** A team whose only role may search and read, so a run reaches the web tools (docs/08). */
const PROBE = `apiVersion: mete/v1
kind: TeamTemplate
metadata: { id: web-probe, name: Web probe, version: 1.0.0 }
pattern: single
roles:
  - { id: reader, name: Reader, goal: Read the web, tier: fast, capabilities: [web.search@1, web.fetch@1] }
tasks:
  - { id: read, role: reader, title: Read a page }
`;

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
});

const write = async (dir: string, name: string, body: unknown) => {
	await mkdir(dir, { recursive: true });
	const file = join(dir, name);
	await writeFile(file, JSON.stringify(body));
	return file;
};

/** The probe team in the workspace, where a run finds the templates it may use (docs/08). */
const teamIn = async (workspaceDir: string) => {
	await mkdir(join(workspaceDir, ".mete", "teams"), { recursive: true });
	await writeFile(
		join(workspaceDir, ".mete", "teams", "web-probe.yaml"),
		PROBE,
	);
};

const script = (dir: string) =>
	write(dir, "web.json", {
		results: [{ title: "Free models", url: PAGE, snippet: "A list" }],
		pages: { [PAGE]: HTML },
	});

const finish = (reason: "stop" | "tool-calls") => ({
	type: "finish",
	reason,
	usage: { prompt: 1, completion: 1 },
});
const call = (name: string, args: unknown) => [
	{ type: "tool-call", id: `c-${name}`, name, args },
	finish("tool-calls"),
];

describe("the web script", () => {
	it("answers Tavily's search, a listed page and nothing else", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const web = scriptedWeb(await script(repo.globalDir));

		const search = await web(TAVILY, { method: "POST" });
		expect(search.status).toBe(200);
		expect(await search.json()).toEqual({
			results: [{ title: "Free models", url: PAGE, content: "A list" }],
		});

		const page = await web(new URL(PAGE));
		expect(page.headers.get("content-type")).toContain("text/html");
		expect(await page.text()).toBe(HTML);

		expect((await web("https://example.org/not-listed")).status).toBe(404);
	});

	it("names the file when the script does not parse", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const bad = await write(repo.globalDir, "bad.json", { results: "nope" });
		expect(() => readWebScript(bad)).toThrow(/METE_SCRIPTED_WEB .*bad\.json/);
	});

	it("keeps a Tavily key in memory and nothing else", async () => {
		const secrets = scriptedSecrets();
		const key = await secrets.get(searchKeyName("tavily"));
		expect(key.ok && key.value).toBe("scripted");
		const none = await secrets.get("providers/nvidia/apiKey");
		expect(none.ok && none.value).toBeUndefined();
		await secrets.set("providers/nvidia/apiKey", "k");
		const saved = await secrets.get("providers/nvidia/apiKey");
		expect(saved.ok && saved.value).toBe("k");
		await secrets.delete("providers/nvidia/apiKey");
		const gone = await secrets.get("providers/nvidia/apiKey");
		expect(gone.ok && gone.value).toBeUndefined();
	});

	it("takes the script from an Env value first, then the environment (ADR-116)", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const file = await script(repo.globalDir);
		expect(webOf({}, () => undefined)).toEqual({});
		expect(
			webOf({}, (name) => (name === SCRIPTED_WEB_ENV ? file : undefined)),
		).toMatchObject({ fetch: expect.any(Function) });
		expect(webOf({ scriptedWeb: file }, () => undefined)).toMatchObject({
			fetch: expect.any(Function),
			secrets: expect.any(Object),
		});
	});
});

describe("a run on the web script", () => {
	it("gives the search and the page to the script, not the network", async () => {
		const repo = await tempRepo({ "README.md": "# notes\n" });
		close = repo.close;
		await teamIn(repo.workspaceDir);
		// The scripts stay outside the workspace, so they never join the run's checkpoints (ADR-111).
		const chat = await write(repo.globalDir, "chat.json", [
			call("web_search", { query: "free models" }),
			call("web_fetch", { url: PAGE }),
			[{ type: "text", text: "Read it." }, finish("stop")],
		]);
		const t = recordingIo();
		const code = await main(
			["run", "--template", "web-probe", "free models"],
			t.io,
			{
				cwd: repo.workspaceDir,
				globalDir: repo.globalDir,
				logger: silent,
				scriptedChat: chat,
				scriptedWeb: await script(repo.globalDir),
			},
		);
		expect(code).toBe(0);
		const out = t.out.join("\n");
		expect(out).toContain("tool  web.search@1");
		expect(out).toContain("tool  web.fetch@1");
		expect(out).not.toContain("failed in");
	});
});
