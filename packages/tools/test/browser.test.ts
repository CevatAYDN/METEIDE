import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	PolicyVerdict,
	SeoAuditOutput,
	ToolAdapter,
} from "@mete/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBrowserModule } from "../src/browser-module.js";
import type { Chromium } from "../src/infrastructure/chromium.js";
import type {
	RunBrowser,
	RunnerRequest,
} from "../src/infrastructure/runner.js";
import { toolContext } from "./helpers/context.js";

// The PNG signature and an IHDR chunk for a 3 x 2 image.
const PNG = Buffer.from(
	"89504e470d0a1a0a0000000d494844520000000300000002",
	"hex",
);
const lhr = (seo: number | null) => ({
	categories: {
		performance: { score: 0.934 },
		accessibility: { score: 1 },
		"best-practices": { score: 0.5 },
		seo: { score: seo },
	},
	audits: {
		"meta-description": {
			id: "meta-description",
			title: "Has a meta description",
			score: 0,
		},
		"font-size": {
			id: "font-size",
			title: "Legible font sizes",
			score: null,
			displayValue: "n/a",
		},
	},
});

const signal = new AbortController().signal;
let dir = "";
type Audit = ToolAdapter<unknown, SeoAuditOutput>;
const asked: RunnerRequest[] = [];

const ready: Chromium = {
	installed: () => true,
	install: async () => ({ ok: true, value: undefined }),
};

const start = async (
	verdict: PolicyVerdict["verdict"],
	answer: (r: RunnerRequest) => Promise<string | null>,
	chromium = ready,
) => {
	const run: RunBrowser = async (req) => {
		asked.push(req);
		const body = await answer(req);
		if (body === null) return { ok: false, error: "Chromium is not installed" };
		await writeFile(req.out, req.kind === "screenshot" ? PNG : body);
		return { ok: true, value: undefined };
	};
	const { ctx, registry } = toolContext(verdict);
	await createBrowserModule({ workspaceDir: dir, run, chromium }).activate(ctx);
	const tool = (ref: "browser.screenshot@1" | "seo.audit@1") => {
		const r = registry.resolve<ToolAdapter<unknown, unknown>>(ref);
		return r.ok ? r.value[0].impl : undefined;
	};
	return tool;
};

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), "mete-browser-"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("browser.screenshot@1", () => {
	it("saves the PNG in .mete/assets and reads its size", async () => {
		const tool = await start("allow", async () => "");
		const r = await tool("browser.screenshot@1")?.run(
			{ url: "https://a.example/" },
			{ signal },
		);
		expect(r).toEqual({
			ok: true,
			value: {
				path: expect.stringMatching(/^\.mete\/assets\/[0-9a-f-]+\.png$/),
				width: 3,
				height: 2,
			},
		});
	});

	it("refuses a private address before the browser starts, and passes the policy's ask", async () => {
		asked.length = 0;
		const tool = await start("allow", async () => "");
		const local = await tool("browser.screenshot@1")?.run(
			{ url: "http://127.0.0.1/" },
			{ signal },
		);
		expect(local?.ok === false && local.error.code).toBe("bad_input");
		const ask = await start("ask", async () => "");
		const r = await ask("browser.screenshot@1")?.run(
			{ url: "https://a.example/" },
			{ signal },
		);
		expect(r?.ok === false && r.error.code).toBe("approval_required");
		expect(asked).toEqual([]);
	});
});

describe("seo.audit@1", () => {
	it("maps Lighthouse scores to 0-100 and keeps an unscored audit as null", async () => {
		const tool = await start("allow", async () => JSON.stringify(lhr(0.81)));
		const r = await (tool("seo.audit@1") as Audit | undefined)?.run(
			{ url: "https://a.example/" },
			{ signal },
		);
		expect(r?.ok && r.value.scores).toEqual({
			performance: 93,
			accessibility: 100,
			bestPractices: 50,
			seo: 81,
		});
		expect(r?.ok && r.value.audits).toEqual([
			{ id: "meta-description", title: "Has a meta description", score: 0 },
			{
				id: "font-size",
				title: "Legible font sizes",
				score: null,
				details: "n/a",
			},
		]);
		expect(r?.ok && r.value.reportPath).toMatch(/\.lighthouse\.json$/);
	});

	it("fails with io for an unscored category and for a runner failure", async () => {
		const unscored = await start("allow", async () =>
			JSON.stringify(lhr(null)),
		);
		const a = await unscored("seo.audit@1")?.run(
			{ url: "https://a.example/" },
			{ signal },
		);
		expect(a?.ok === false && a.error).toEqual({
			code: "io",
			message: "Lighthouse did not score the seo category",
		});
		const broken = await start("allow", async () => null);
		const b = await broken("seo.audit@1")?.run(
			{ url: "https://a.example/" },
			{ signal },
		);
		expect(b?.ok === false && b.error).toEqual({
			code: "io",
			message: "Chromium is not installed",
		});
	});
});

describe("Chromium on first use", () => {
	it("installs a missing Chromium once before the call, and reports a failed install", async () => {
		const steps: string[] = [];
		let present = false;
		const chromium: Chromium = {
			installed: () => present,
			install: async () => {
				steps.push("install");
				present = true;
				return { ok: true, value: undefined };
			},
		};
		const tool = await start(
			"allow",
			async () => {
				steps.push("run");
				return "";
			},
			chromium,
		);
		await tool("browser.screenshot@1")?.run(
			{ url: "https://a.example/" },
			{ signal },
		);
		await tool("browser.screenshot@1")?.run(
			{ url: "https://a.example/" },
			{ signal },
		);
		expect(steps).toEqual(["install", "run", "run"]);
		const failing: Chromium = {
			installed: () => false,
			install: async () => ({ ok: false, error: "no disk space" }),
		};
		const broken = await start("allow", async () => "", failing);
		expect(
			await broken("browser.screenshot@1")?.run(
				{ url: "https://a.example/" },
				{ signal },
			),
		).toEqual({
			ok: false,
			error: { code: "io", message: "no disk space" },
		});
	});
});
