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
import type { RunBrowser } from "../infrastructure/runner.js";
import { parse, permit } from "./fs-common.js";

// browser.screenshot@1 and seo.audit@1 (docs/10, Built-in tools): a public http or https page,
// policy.check@1 with net.fetch, the work in a child process, the files in .mete/assets/.

export type BrowserDeps = {
	readonly adapterId: string;
	readonly workspaceDir: string;
	readonly policy: () => PolicyCheckAdapter | undefined;
	readonly run: RunBrowser;
};

type Out<T> = Promise<Result<T, ToolError>>;

const io = (message: string): ToolError => ({ code: "io", message });

const allow = (
	deps: BrowserDeps,
	capability: "browser.screenshot@1" | "seo.audit@1",
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

/** browser.screenshot@1: a PNG of the page, the viewport only unless fullPage. */
export const screenshotTool = async (
	deps: BrowserDeps,
	input: unknown,
	ctx: ToolContext,
): Out<BrowserScreenshotOutput> => {
	const i = parse(BrowserScreenshotInputSchema, input);
	if (!i.ok) return i;
	const allowed = allow(deps, "browser.screenshot@1", i.value, ctx);
	if (!allowed.ok) return allowed;
	const { path, out } = await asset(deps, "png");
	const ran = await deps.run(
		{ kind: "screenshot", ...i.value, out },
		ctx.signal,
	);
	if (!ran.ok) return err(io(ran.error));
	const bytes = await read(out);
	if (!bytes.ok) return bytes;
	const size = pngSize(bytes.value);
	return size ? ok({ path, ...size }) : err(io("the screenshot is not a PNG"));
};

/** seo.audit@1: the page's Lighthouse scores and audits, the full report saved beside them. */
export const auditTool = async (
	deps: BrowserDeps,
	input: unknown,
	ctx: ToolContext,
): Out<SeoAuditOutput> => {
	const i = parse(SeoAuditInputSchema, input);
	if (!i.ok) return i;
	const allowed = allow(deps, "seo.audit@1", i.value, ctx);
	if (!allowed.ok) return allowed;
	const { path, out } = await asset(deps, "lighthouse.json");
	const ran = await deps.run(
		{ kind: "audit", url: i.value.url, out },
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
