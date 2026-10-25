import {
	err,
	ok,
	type PolicyCheckAdapter,
	type Result,
	type ToolContext,
	type ToolError,
	WebFetchInputSchema,
	type WebFetchOutput,
} from "@mete/contracts";
import {
	WEB_FETCH_MAX_BYTES,
	WEB_FETCH_MAX_CHARS,
	WEB_FETCH_MAX_REDIRECTS,
	WEB_FETCH_TIMEOUT_MS,
} from "../defaults.js";
import { isPublicHost } from "../domain/addresses.js";
import { pageMarkdown } from "../infrastructure/page.js";
import { parse, permit } from "./fs-common.js";

// web.fetch@1 (docs/10, Built-in tools): policy.check@1 with action net.fetch, then the page as
// Markdown. Every redirect hop must be a public http or https address (SECURITY.md, threats).

/** What the web tools need: their adapter id, the policy and a fetch the tests replace. */
export type WebDeps = {
	readonly adapterId: string;
	readonly policy: () => PolicyCheckAdapter | undefined;
	readonly fetch: typeof fetch;
};

type Out<T> = Promise<Result<T, ToolError>>;
type Page = { url: URL; type: string; text: string };

const bad = (message: string): ToolError => ({ code: "bad_input", message });
const io = (message: string): ToolError => ({ code: "io", message });

const checkHop = (url: URL) => {
	if (url.protocol !== "http:" && url.protocol !== "https:")
		return bad(`${url.href} is not an http or https address`);
	if (!isPublicHost(url.hostname))
		return bad(`${url.hostname} is not a public address`);
	return undefined;
};

// Reads the body up to the byte cap, so a hostile page cannot fill memory.
const readCapped = async (res: Response): Out<Uint8Array> => {
	const reader = res.body?.getReader();
	const parts: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const chunk = await reader?.read();
		if (!chunk || chunk.done) break;
		size += chunk.value.byteLength;
		if (size > WEB_FETCH_MAX_BYTES) {
			await reader?.cancel();
			return err(io(`the page is larger than ${WEB_FETCH_MAX_BYTES} bytes`));
		}
		parts.push(chunk.value);
	}
	return ok(Buffer.concat(parts));
};

const decode = (bytes: Uint8Array, type: string) => {
	const charset = /charset=([^;]+)/i.exec(type)?.[1]?.trim() ?? "utf-8";
	try {
		return new TextDecoder(charset).decode(bytes);
	} catch {
		return new TextDecoder().decode(bytes);
	}
};

const hop = async (deps: WebDeps, url: URL, signal: AbortSignal) => {
	try {
		return ok(await deps.fetch(url, { redirect: "manual", signal }));
	} catch (e) {
		const why = e instanceof Error ? e.message : String(e);
		return err(io(`${url.href}: ${why}`));
	}
};

// One hop: the page, or where a redirect points next.
const visit = async (
	deps: WebDeps,
	url: URL,
	signal: AbortSignal,
): Out<Page | URL> => {
	const refused = checkHop(url);
	if (refused) return err(refused);
	const res = await hop(deps, url, signal);
	if (!res.ok) return res;
	const location = res.value.headers.get("location");
	if (res.value.status >= 300 && res.value.status < 400 && location)
		return ok(new URL(location, url));
	if (!res.value.ok) return err(io(`${url.href} answered ${res.value.status}`));
	const body = await readCapped(res.value);
	if (!body.ok) return body;
	const type = res.value.headers.get("content-type") ?? "text/html";
	return ok({ url, type, text: decode(body.value, type) });
};

const download = async (
	deps: WebDeps,
	start: URL,
	signal: AbortSignal,
): Out<Page> => {
	let url = start;
	for (let n = 0; n <= WEB_FETCH_MAX_REDIRECTS; n++) {
		const r = await visit(deps, url, signal);
		if (!r.ok) return r;
		if (!(r.value instanceof URL)) return ok(r.value);
		url = r.value;
	}
	return err(io(`more than ${WEB_FETCH_MAX_REDIRECTS} redirects`));
};

const toOutput = async (
	page: Page,
): Promise<Result<WebFetchOutput, ToolError>> => {
	const html = /text\/html|application\/xhtml/i.test(page.type);
	if (!html && !/^text\//i.test(page.type))
		return err(bad(`${page.type} is not a text page`));
	const { title, markdown } = html
		? await pageMarkdown(page.text)
		: { title: "", markdown: page.text };
	return ok({
		markdown: markdown.slice(0, WEB_FETCH_MAX_CHARS),
		title,
		finalUrl: page.url.href,
	});
};

/** web.fetch@1: one public page as Markdown, cut to WEB_FETCH_MAX_CHARS characters. */
export const fetchTool = async (
	deps: WebDeps,
	input: unknown,
	ctx: ToolContext,
): Out<WebFetchOutput> => {
	const i = parse(WebFetchInputSchema, input);
	if (!i.ok) return i;
	const check = {
		action: "net.fetch",
		capability: "web.fetch@1",
		args: i.value,
	} as const;
	const allowed = permit(deps, check, ctx);
	if (!allowed.ok) return allowed;
	const signal = AbortSignal.any([
		ctx.signal,
		AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS),
	]);
	const page = await download(deps, new URL(i.value.url), signal);
	return page.ok ? await toOutput(page.value) : page;
};
