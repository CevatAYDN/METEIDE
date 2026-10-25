import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SeoAuditReportSchema } from "@mete/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { SCRIPTED_BROWSER_ENV } from "../src/defaults.js";
import {
	browserOf,
	readBrowserScript,
	scriptedBrowser,
} from "../src/infrastructure/scripted-browser.js";
import { main } from "../src/main.js";
import { recordingIo, silent, tempRepo } from "./helpers.js";

// The browser half of the scripted app (docs/15, LLM replay; ADR-117): a JSON file answers the
// screenshots and the Lighthouse audits, so a template that measures a page runs with no Chromium
// and no network, while the real browser tools read the files back.

const PAGE = "https://shop.example/";
const RIVAL = "https://rival.example/";

// A small Lighthouse report; the audit ids are what the fixes must cite.
const LHR = {
	categories: {
		performance: { score: 0.72 },
		accessibility: { score: 0.9 },
		"best-practices": { score: 1 },
		seo: { score: 0.64 },
	},
	audits: {
		"meta-description": {
			id: "meta-description",
			title: "Has a meta description",
			score: 0,
		},
		"image-alt": { id: "image-alt", title: "Images have alt text", score: 0.5 },
	},
};

const REPORT = JSON.stringify({
	url: PAGE,
	summary: "The page lacks a meta description and image alt text.",
	scores: { performance: 72, accessibility: 90, bestPractices: 100, seo: 64 },
	fixes: [
		{
			priority: "high",
			title: "Add a meta description",
			why: "Search results show it",
			how: "Write one sentence per page",
			auditIds: ["meta-description"],
		},
		{
			priority: "medium",
			title: "Describe every image",
			why: "Screen readers read alt text",
			how: "Add alt to each img",
			auditIds: ["image-alt"],
		},
	],
});

const finish = (reason: "stop" | "tool-calls") => ({
	type: "finish",
	reason,
	usage: { prompt: 10, completion: 5 },
});
const say = (text: string) => [{ type: "text", text }, finish("stop")];
const call = (name: string, args: unknown) => [
	{ type: "tool-call", id: `c-${name}`, name, args },
	finish("tool-calls"),
];

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

/** The audit tool's own reading of a PNG: its IHDR width and height. */
const pngSize = (bytes: Buffer) => ({
	width: bytes.readUInt32BE(16),
	height: bytes.readUInt32BE(20),
});

describe("the browser script", () => {
	it("writes a real PNG of the scripted size", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const file = await write(repo.globalDir, "browser.json", {
			screenshots: [{ width: 320, height: 200 }],
		});
		const out = join(repo.globalDir, "shot.png");
		const browser = scriptedBrowser(file);
		const done = await browser.run?.(
			{ kind: "screenshot", target: { url: PAGE }, fullPage: false, out },
			new AbortController().signal,
		);
		expect(done).toEqual({ ok: true, value: undefined });
		const bytes = await readFile(out);
		expect(bytes.subarray(0, 8)).toEqual(
			Buffer.from("89504e470d0a1a0a", "hex"),
		);
		expect(pngSize(bytes)).toEqual({ width: 320, height: 200 });
	});

	it("writes the scripted reports in order, the last repeating", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const second = {
			...LHR,
			categories: { ...LHR.categories, seo: { score: 1 } },
		};
		const file = await write(repo.globalDir, "browser.json", {
			audits: [LHR, second],
		});
		const browser = scriptedBrowser(file);
		const audit = async () => {
			const out = join(repo.globalDir, `report-${Math.random()}.json`);
			await browser.run?.(
				{ kind: "audit", target: { url: PAGE }, out },
				new AbortController().signal,
			);
			return JSON.parse(await readFile(out, "utf8"));
		};
		expect((await audit()).categories.seo.score).toBe(0.64);
		expect((await audit()).categories.seo.score).toBe(1);
		expect((await audit()).categories.seo.score).toBe(1);
	});

	it("fails a kind the script does not name, with the file", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const file = await write(repo.globalDir, "browser.json", {
			screenshots: [{ width: 10, height: 10 }],
		});
		const done = await scriptedBrowser(file).run?.(
			{ kind: "audit", target: { url: PAGE }, out: join(repo.globalDir, "x") },
			new AbortController().signal,
		);
		expect(done?.ok).toBe(false);
		expect(done).toMatchObject({
			error: expect.stringMatching(
				/METE_SCRIPTED_BROWSER .*browser\.json.*audit/,
			),
		});
	});

	it("names the file when the script does not parse", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const bad = await write(repo.globalDir, "bad.json", {
			screenshots: "nope",
		});
		expect(() => readBrowserScript(bad)).toThrow(
			/METE_SCRIPTED_BROWSER .*bad\.json/,
		);
	});

	it("takes the script from an Env value first, then the environment (ADR-117)", async () => {
		const repo = await tempRepo({ "a.txt": "a\n" });
		close = repo.close;
		const file = await write(repo.globalDir, "browser.json", {
			screenshots: [{ width: 10, height: 10 }],
		});
		expect(browserOf({}, () => undefined)).toEqual({});
		expect(
			browserOf({}, (name) =>
				name === SCRIPTED_BROWSER_ENV ? file : undefined,
			),
		).toMatchObject({ browser: { run: expect.any(Function) } });
		expect(browserOf({ scriptedBrowser: file }, () => undefined)).toMatchObject(
			{ browser: { chromium: expect.any(Object) } },
		);
	});
});

describe("a run on the browser script", () => {
	it("audits the page for the seo-audit team without opening it", async () => {
		const repo = await tempRepo({ "README.md": "# shop\n" });
		close = repo.close;
		const chat = await write(repo.globalDir, "chat.json", [
			call("seo_audit", { url: PAGE }),
			call("browser_screenshot", { url: PAGE }),
			say(
				"Scores: performance 72, accessibility 90, bestPractices 100, seo 64.",
			),
			call("web_fetch", { url: PAGE }),
			say("The page has a title but no meta description."),
			call("web_search", { query: "hand-made goods shop" }),
			say(`A rival (${RIVAL}) describes every product.`),
			say(REPORT),
		]);
		const web = await write(repo.globalDir, "web.json", {
			results: [{ title: "Rival shop", url: RIVAL, snippet: "A shop" }],
			pages: {
				[PAGE]:
					"<html><head><title>Shop</title></head><body><h1>Shop</h1></body></html>",
				[RIVAL]:
					"<html><head><title>Rival</title></head><body><h1>Rival</h1></body></html>",
			},
		});
		const browser = await write(repo.globalDir, "browser.json", {
			screenshots: [{ width: 1280, height: 720 }],
			audits: [LHR],
		});
		const t = recordingIo();
		const code = await main(["run", "--template", "seo-audit", PAGE], t.io, {
			cwd: repo.workspaceDir,
			globalDir: repo.globalDir,
			logger: silent,
			scriptedChat: chat,
			scriptedWeb: web,
			scriptedBrowser: browser,
		});
		expect(code).toBe(0);
		expect(t.out).toEqual(
			expect.arrayContaining([
				"tool  seo.audit@2",
				"tool  browser.screenshot@2",
			]),
		);
		const runId = /^run (\S+) started$/.exec(t.out[0] ?? "")?.[1] ?? "";
		const file = join(
			repo.workspaceDir,
			".mete",
			"artifacts",
			runId,
			"report.json",
		);
		const report = SeoAuditReportSchema.parse(
			JSON.parse(await readFile(file, "utf8")),
		);
		const ids = Object.keys(LHR.audits);
		expect(
			report.fixes.flatMap((f) => f.auditIds).every((id) => ids.includes(id)),
		).toBe(true);

		// The tool wrote the scripted report and the image into the workspace's assets.
		const assets = join(repo.workspaceDir, ".mete", "assets");
		const names = await readdir(assets);
		expect(names.some((n) => n.endsWith(".lighthouse.json"))).toBe(true);
		const png = names.find((n) => n.endsWith(".png")) ?? "";
		expect(pngSize(await readFile(join(assets, png)))).toEqual({
			width: 1280,
			height: 720,
		});
	}, 60_000);
});
