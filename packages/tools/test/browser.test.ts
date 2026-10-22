import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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
let globalDir = "";
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
	await createBrowserModule({
		workspaceDir: dir,
		globalDir,
		run,
		chromium,
	}).activate(ctx);
	const tool = (ref: "browser.screenshot@2" | "seo.audit@2") => {
		const r = registry.resolve<ToolAdapter<unknown, unknown>>(ref);
		return r.ok ? r.value[0].impl : undefined;
	};
	return tool;
};

beforeAll(async () => {
	dir = await realpath(await mkdtemp(join(tmpdir(), "mete-browser-")));
	globalDir = await realpath(
		await mkdtemp(join(tmpdir(), "mete-browser-global-")),
	);
	await mkdir(join(globalDir, "worktrees"), { recursive: true });
});
afterAll(async () => {
	await rm(dir, { recursive: true, force: true });
	await rm(globalDir, { recursive: true, force: true });
});

describe("browser.screenshot@2", () => {
	it("saves the PNG in .mete/assets and reads its size", async () => {
		const tool = await start("allow", async () => "");
		const r = await tool("browser.screenshot@2")?.run(
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
		const local = await tool("browser.screenshot@2")?.run(
			{ url: "http://127.0.0.1/" },
			{ signal },
		);
		expect(local?.ok === false && local.error.code).toBe("bad_input");
		const ask = await start("ask", async () => "");
		const r = await ask("browser.screenshot@2")?.run(
			{ url: "https://a.example/" },
			{ signal },
		);
		expect(r?.ok === false && r.error.code).toBe("approval_required");
		expect(asked).toEqual([]);
	});
});

describe("seo.audit@2", () => {
	it("maps Lighthouse scores to 0-100 and keeps an unscored audit as null", async () => {
		const tool = await start("allow", async () => JSON.stringify(lhr(0.81)));
		const r = await (tool("seo.audit@2") as Audit | undefined)?.run(
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
		const a = await unscored("seo.audit@2")?.run(
			{ url: "https://a.example/" },
			{ signal },
		);
		expect(a?.ok === false && a.error).toEqual({
			code: "io",
			message: "Lighthouse did not score the seo category",
		});
		const broken = await start("allow", async () => null);
		const b = await broken("seo.audit@2")?.run(
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
		await tool("browser.screenshot@2")?.run(
			{ url: "https://a.example/" },
			{ signal },
		);
		await tool("browser.screenshot@2")?.run(
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
			await broken("browser.screenshot@2")?.run(
				{ url: "https://a.example/" },
				{ signal },
			),
		).toEqual({
			ok: false,
			error: { code: "io", message: "no disk space" },
		});
	});
});

// A built site (docs/10, Built-in tools): the tool serves the folder itself, so the caller gives no address.
describe("a built folder", () => {
	const site = async (root: string, name: string, index = true) => {
		await mkdir(join(root, name), { recursive: true });
		if (index) await writeFile(join(root, name, "index.html"), "<h1>hi</h1>");
		return join(root, name);
	};
	const open =
		(ref: "browser.screenshot@2" | "seo.audit@2") =>
		async (input: unknown, cwd?: string) => {
			asked.length = 0;
			const tool = await start("ask", async () => JSON.stringify(lhr(0.9)));
			return tool(ref)?.run(input, { signal, ...(cwd ? { cwd } : {}) });
		};

	it("hands the runner the real folder and asks no net.fetch question", async () => {
		const real = await site(dir, "dist");
		const shot = await open("browser.screenshot@2")({ folder: "dist" });
		expect(shot?.ok).toBe(true);
		const audit = await open("seo.audit@2")({ folder: "dist" });
		expect(audit?.ok).toBe(true);
		expect(asked.map((r) => [r.kind, r.target])).toEqual([
			["audit", { folder: real }],
		]);
	});

	it("refuses a folder outside the workspace, one that is a file, one without index.html and an ignored one", async () => {
		await site(dir, "empty", false);
		await writeFile(join(dir, "page.html"), "x");
		await site(dir, "secrets/site");
		const outside = await mkdtemp(join(tmpdir(), "mete-elsewhere-"));
		await writeFile(join(outside, "index.html"), "x");
		try {
			const audit = open("seo.audit@2");
			const code = async (folder: string) => {
				const r = await audit({ folder });
				return r?.ok === false ? r.error.code : "ok";
			};
			expect(await code(outside)).toBe("outside_workspace");
			expect(await code("../elsewhere")).toBe("outside_workspace");
			expect(await code("page.html")).toBe("bad_input");
			expect(await code("empty")).toBe("bad_input");
			expect(await code("secrets/site")).toBe("ignored");
			expect(await code("missing")).toBe("bad_input");
			expect(asked).toEqual([]);
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	it("reads a relative folder from the task's worktree and keeps the call inside it", async () => {
		const tree = join(globalDir, "worktrees", "r1", "t1");
		const real = await site(tree, "out");
		await site(dir, "out");
		const audit = open("seo.audit@2");
		expect((await audit({ folder: "out" }, tree))?.ok).toBe(true);
		expect(asked.map((r) => r.target)).toEqual([{ folder: real }]);
		const climb = await audit({ folder: join(dir, "out") }, tree);
		expect(climb?.ok === false && climb.error.code).toBe("outside_workspace");
	});
});
