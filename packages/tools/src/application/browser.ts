import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	BrowserScreenshotInputSchema,
	type BrowserScreenshotOutput,
	err,
	ok,
	type PolicyCheckAdapter,
	type Result,
	SeoAuditInputSchema,
	type SeoAuditOutput,
	type ToolContext,
	type ToolError,
} from "@mete/contracts";
import { isPublicHost } from "../domain/addresses.js";
import { auditOutput, LhrSchema } from "../domain/lighthouse.js";
import { pngSize } from "../domain/png.js";
import type { Chromium } from "../infrastructure/chromium.js";
import { kindOf } from "../infrastructure/files.js";
import type { RunBrowser, Target } from "../infrastructure/runner.js";
import {
	ignoredError,
	outside,
	parse,
	permit,
	place,
	rules,
	scoped,
} from "./fs-common.js";

// browser.screenshot@2 and seo.audit@2 (docs/10, Built-in tools): a public http or https page,
// policy.check@1 with net.fetch, the work in a child process, the files in .mete/assets/.

export type BrowserDeps = {
	readonly adapterId: string;
	readonly workspaceDir: string;
	readonly worktreesDir: string;
	readonly policy: () => PolicyCheckAdapter | undefined;
	readonly run: RunBrowser;
	readonly chromium: Chromium;
};

type Out<T> = Promise<Result<T, ToolError>>;

const io = (message: string): ToolError => ({ code: "io", message });

const allow = (
	deps: BrowserDeps,
	capability: "browser.screenshot@2" | "seo.audit@2",
	args: { url: string },
	ctx: ToolContext,
): Result<void, ToolError> => {
	const { hostname } = new URL(args.url);
	if (!isPublicHost(hostname))
		return err({
			code: "bad_input",
			message: `${hostname} is not a public address`,
		});
	return permit(deps, { action: "net.fetch", capability, args }, ctx);
};

// A built site's folder: inside the workspace or the task's worktree, not excluded by .meteignore,
// holding an index.html. Nothing leaves the machine, so there is no net.fetch to ask about.
const folderTarget = async (
	deps: BrowserDeps,
	folder: string,
	ctx: ToolContext,
): Out<Target> => {
	const here = await scoped(deps, ctx);
	if (!here.ok) return here;
	const at = await place(here.value, folder);
	if (!at.ok) return at;
	if (!at.value.inside) return err(outside(folder));
	const ignored = await rules(here.value);
	if (!ignored.ok) return ignored;
	if (ignored.value(at.value.real, true)) return err(ignoredError(folder));
	const index = await kindOf(join(at.value.real, "index.html"));
	if (!index.ok || index.value !== "file")
		return err({
			code: "bad_input",
			message: `${folder} is not a folder with an index.html`,
		});
	return ok({ folder: at.value.real });
};

// What to open: a public page the policy allows, or a built folder.
const targetOf = async (
	deps: BrowserDeps,
	capability: "browser.screenshot@2" | "seo.audit@2",
	input: { url: string } | { folder: string },
	ctx: ToolContext,
): Out<Target> => {
	if ("folder" in input) return folderTarget(deps, input.folder, ctx);
	const allowed = allow(deps, capability, input, ctx);
	return allowed.ok ? ok({ url: input.url }) : allowed;
};

// Chromium is installed on first use, after the policy allows runtime.install (allowed at level 2).
const ensureChromium = async (
	deps: BrowserDeps,
	capability: "browser.screenshot@2" | "seo.audit@2",
	ctx: ToolContext,
): Promise<Result<void, ToolError>> => {
	if (deps.chromium.installed()) return ok(undefined);
	const check = {
		action: "runtime.install",
		capability,
		command: "playwright install chromium",
		args: {},
	} as const;
	const allowed = permit(deps, check, ctx);
	if (!allowed.ok) return allowed;
	const installed = await deps.chromium.install(ctx.signal);
	return installed.ok ? installed : err(io(installed.error));
};

// A new file name in .mete/assets/: the workspace-relative path and the absolute one.
const asset = async (deps: BrowserDeps, ext: string) => {
	const name = `${randomUUID()}.${ext}`;
	const dir = join(deps.workspaceDir, ".mete", "assets");
	await mkdir(dir, { recursive: true });
	return { path: `.mete/assets/${name}`, out: join(dir, name) };
};

const read = async (file: string) => {
	try {
		return ok(await readFile(file));
	} catch (e) {
		return err(
			io(
				`the browser wrote no file: ${e instanceof Error ? e.message : String(e)}`,
			),
		);
	}
};

/** browser.screenshot@2: a PNG of the page, the viewport only unless fullPage. */
export const screenshotTool = async (
	deps: BrowserDeps,
	input: unknown,
	ctx: ToolContext,
): Out<BrowserScreenshotOutput> => {
	const i = parse(BrowserScreenshotInputSchema, input);
	if (!i.ok) return i;
	const target = await targetOf(deps, "browser.screenshot@2", i.value, ctx);
	if (!target.ok) return target;
	const ready = await ensureChromium(deps, "browser.screenshot@2", ctx);
	if (!ready.ok) return ready;
	const { path, out } = await asset(deps, "png");
	const ran = await deps.run(
		{
			kind: "screenshot",
			target: target.value,
			fullPage: i.value.fullPage,
			out,
		},
		ctx.signal,
	);
	if (!ran.ok) return err(io(ran.error));
	const bytes = await read(out);
	if (!bytes.ok) return bytes;
	const size = pngSize(bytes.value);
	return size ? ok({ path, ...size }) : err(io("the screenshot is not a PNG"));
};

/** seo.audit@2: the page's Lighthouse scores and audits, the full report saved beside them. */
export const auditTool = async (
	deps: BrowserDeps,
	input: unknown,
	ctx: ToolContext,
): Out<SeoAuditOutput> => {
	const i = parse(SeoAuditInputSchema, input);
	if (!i.ok) return i;
	const target = await targetOf(deps, "seo.audit@2", i.value, ctx);
	if (!target.ok) return target;
	const ready = await ensureChromium(deps, "seo.audit@2", ctx);
	if (!ready.ok) return ready;
	const { path, out } = await asset(deps, "lighthouse.json");
	const ran = await deps.run(
		{ kind: "audit", target: target.value, out },
		ctx.signal,
	);
	if (!ran.ok) return err(io(ran.error));
	const bytes = await read(out);
	if (!bytes.ok) return bytes;
	let lhr: unknown;
	try {
		lhr = JSON.parse(bytes.value.toString("utf8"));
	} catch {
		return err(io("the Lighthouse report is not JSON"));
	}
	const parsed = LhrSchema.safeParse(lhr);
	if (!parsed.success)
		return err(
			io(`the Lighthouse report is unreadable: ${parsed.error.message}`),
		);
	const mapped = auditOutput(parsed.data);
	return mapped.ok
		? ok({ ...mapped.value, reportPath: path })
		: err(io(mapped.error));
};
