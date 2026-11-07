import { once } from "node:events";
import { type IncomingHttpHeaders, request } from "node:http";
import { connect } from "node:net";
import { err, ok } from "@mete/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	OAUTH_CALLBACK_CODE_CHARS,
	OAUTH_CALLBACK_STATE_CHARS,
	OAUTH_CALLBACK_URL_CHARS,
	OAUTH_TIMEOUT_MS,
} from "../src/defaults.js";
import {
	type OAuthCallback,
	openOAuthCallback,
} from "../src/infrastructure/oauth-callback.js";

const opened: OAuthCallback[] = [];
type Input = { method?: string; host?: string; path?: string; suffix?: string };
const query =
	"?code=private-code&state=expected&iss=https%3A%2F%2Fissuer.invalid";
const denial =
	"?error=access_denied&state=expected&iss=https%3A%2F%2Fissuer.invalid&error_description=private-denial";
const validate = (url: string) => {
	const params = new URL(url).searchParams;
	return params.get("state") === "expected" &&
		params.get("iss") === "https://issuer.invalid"
		? ok(undefined)
		: err("private-validation-error");
};
const open = async (
	signal = new AbortController().signal,
	check = validate,
) => {
	const result = await openOAuthCallback({ signal, validate: check });
	if (!result.ok) throw new Error("fixture listener failed");
	opened.push(result.value);
	return result.value;
};
const send = (url: string, options: Input = {}) =>
	new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>(
		(resolve, reject) => {
			const target = new URL(url);
			const req = request(
				target,
				{
					method: options.method ?? "GET",
					path: options.path ?? `${target.pathname}${target.search}`,
					headers: { host: options.host ?? target.host },
					agent: false,
				},
				(response) => {
					let body = "";
					response.setEncoding("utf8");
					response.on("data", (part: string) => {
						body += part;
					});
					response.on("error", reject);
					response.on("end", () =>
						resolve({
							status: response.statusCode ?? 0,
							headers: response.headers,
							body,
						}),
					);
				},
			);
			req.on("error", reject);
			req.end();
		},
	);

afterEach(async () => {
	await Promise.all(opened.splice(0).map((flow) => flow.close()));
	vi.useRealTimers();
});

describe("OAuth loopback callback", () => {
	it("accepts once, returns the exact URL and releases the random listener", async () => {
		const check = vi.fn(validate);
		const flow = await open(undefined, check);
		const other = await open();
		const target = new URL(flow.redirectUrl);
		expect(target.hostname).toBe("127.0.0.1");
		expect(Number(target.port)).toBeGreaterThan(0);
		expect(target.pathname).not.toBe(new URL(other.redirectUrl).pathname);
		const url = `${flow.redirectUrl}${query}`;
		const response = await send(url);
		expect(response.status).toBe(200);
		expect(response.body).not.toContain("private-code");
		expect(await flow.wait()).toEqual(ok(url));
		expect(await flow.wait()).toEqual(ok(url));
		await expect(send(url)).rejects.toThrow();
		expect(check).toHaveBeenCalledExactlyOnceWith(url);
	});

	it("settles an authenticated denial promptly without exposing error text", async () => {
		const check = vi.fn(validate);
		const flow = await open(undefined, check);
		const url = `${flow.redirectUrl}${denial}`;
		const response = await send(url);
		expect(response.status).toBe(200);
		expect(response.headers["cache-control"]).toContain("no-store");
		expect(response.body).not.toMatch(/access_denied|private|expected|issuer/);
		const result = err({
			code: "io",
			message: "Callback authorization failed",
		});
		expect(await flow.wait()).toEqual(result);
		expect(await flow.wait()).toEqual(result);
		await expect(send(url)).rejects.toThrow();
		expect(check).toHaveBeenCalledExactlyOnceWith(url);
	});

	it.each<Input>([
		{ method: "POST" },
		{ host: "localhost:1" },
		{ host: "127.0.0.1" },
		{ path: `/wrong${query}` },
		{ suffix: query.replace("expected", "wrong-state") },
		{ suffix: query.replace("issuer.invalid", "wrong.invalid") },
		{ suffix: `${query}&code=replay` },
		{ suffix: `${query}&%73tate=expected` },
		{ suffix: `${query}&iss=https%3A%2F%2Fissuer.invalid` },
		{ suffix: `${query}&error=private-error&error=other` },
		{ suffix: `${query}&error=access_denied` },
		{ suffix: denial.replace("expected", "wrong-state") },
		{ suffix: denial.replace("issuer.invalid", "wrong.invalid") },
		{ suffix: `${denial}&error=other` },
		{ suffix: denial.replace("access_denied", "") },
		{ suffix: `${denial}&error_description=other` },
		{
			suffix: `?error=${"x".repeat(OAUTH_CALLBACK_URL_CHARS + 1)}&state=expected`,
		},
		{ suffix: "?code=&state=expected" },
		{
			suffix: `?code=${"x".repeat(OAUTH_CALLBACK_CODE_CHARS + 1)}&state=expected`,
		},
		{ suffix: `?code=x&state=${"x".repeat(OAUTH_CALLBACK_STATE_CHARS + 1)}` },
		{ suffix: `${query}&extra=${"x".repeat(OAUTH_CALLBACK_URL_CHARS)}` },
	])(
		"rejects unsolicited invalid input without consuming the flow: %j",
		async (input) => {
			const flow = await open();
			const response = await send(
				`${flow.redirectUrl}${input.suffix ?? query}`,
				input,
			);
			expect(response.status).toBe(400);
			expect(response.headers["cache-control"]).toContain("no-store");
			expect(response.headers["content-type"]).toContain("text/plain");
			expect(response.body).not.toMatch(/private|wrong|expected|issuer/);
			expect((await send(`${flow.redirectUrl}${query}`)).status).toBe(200);
			expect((await flow.wait()).ok).toBe(true);
		},
	);

	it("sanitizes a throwing validator and leaves the flow available", async () => {
		const check = vi.fn(validate).mockImplementationOnce(() => {
			throw new Error("private-validator-exception");
		});
		const flow = await open(undefined, check);
		expect((await send(`${flow.redirectUrl}${query}`)).body).not.toContain(
			"private",
		);
		expect((await send(`${flow.redirectUrl}${query}`)).status).toBe(200);
	});

	it("refuses pre-aborted and aborted-during-bind attempts", async () => {
		for (const before of [true, false]) {
			const controller = new AbortController();
			if (before) controller.abort("private-reason");
			const pending = openOAuthCallback({
				signal: controller.signal,
				validate,
			});
			controller.abort("private-reason");
			const result = await pending;
			expect(result).toMatchObject({ ok: false, error: { code: "io" } });
			expect(JSON.stringify(result)).not.toContain("private");
		}
	});

	it.each(["abort", "close", "timeout"])(
		"settles %s before a request and destroys open sockets",
		async (mode) => {
			if (mode === "timeout")
				vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
			const controller = new AbortController();
			const flow = await open(controller.signal);
			const socket = connect(
				Number(new URL(flow.redirectUrl).port),
				"127.0.0.1",
			);
			await once(socket, "connect");
			const closed = once(socket, "close");
			if (mode === "abort") controller.abort("private-abort");
			if (mode === "close") await flow.close();
			if (mode === "timeout")
				await vi.advanceTimersByTimeAsync(OAUTH_TIMEOUT_MS);
			expect(await flow.wait()).toMatchObject({
				ok: false,
				error: { code: "io" },
			});
			await closed;
			await flow.close();
			await expect(send(`${flow.redirectUrl}${query}`)).rejects.toThrow();
		},
	);
});
