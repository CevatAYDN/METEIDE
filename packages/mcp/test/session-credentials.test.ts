import { tmpdir } from "node:os";
import { parse } from "node:path";
import {
	err,
	type McpCredentialField,
	type McpServer,
	ok,
	type Result,
	type SecretStore,
	type ToolError,
} from "@mete/contracts";
import {
	Client,
	InMemoryTransport,
	UnauthorizedError,
} from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCalls } from "../src/application/calls.js";
import {
	createSessions,
	type SessionDeps,
} from "../src/application/sessions.js";
import { createCredentialFields } from "../src/infrastructure/credential-fields.js";
import { createCredentialRecords } from "../src/infrastructure/credential-records.js";
import type {
	OAuthSignInOptions,
	SignInFlow,
} from "../src/infrastructure/oauth.js";

const script = vi.hoisted(() => ({
	options: [] as OAuthSignInOptions[],
	events: [] as string[],
	commitFails: false,
	exchangeFails: false,
	saved: false,
	publish: undefined as
		| ((options: OAuthSignInOptions) => Promise<Result<void, ToolError>>)
		| undefined,
}));
vi.mock("../src/infrastructure/oauth.js", () => ({
	oauthSignIn: vi.fn(async (options: OAuthSignInOptions) => {
		script.options.push(options);
		options.onSecrets?.(["private-access", "private-refresh"]);
		if (!options.interactive && !script.saved)
			return err({
				code: "io",
				message: "Sign in with mete run in a terminal",
			});
		const flow: SignInFlow = {
			provider: {
				redirectUrl: options.redirectUrl ?? "http://127.0.0.1/callback",
				clientMetadata: { redirect_uris: ["http://127.0.0.1/callback"] },
				codeVerifier: () => "verifier",
				clientInformation: () => undefined,
				tokens: () => undefined,
				saveTokens: () => {},
				redirectToAuthorization: () => {},
				saveCodeVerifier: () => {},
			},
			url: () => new URL("https://issuer.invalid/authorize"),
			codeFrom: (pasted) =>
				pasted === "valid"
					? ok({ code: "code" })
					: err("Invalid sign-in callback"),
			commit: async () => {
				script.events.push("commit");
				if (script.publish) return script.publish(options);
				return script.commitFails
					? err({ code: "io", message: "private-commit-error" })
					: ok(undefined);
			},
		};
		return ok(flow);
	}),
}));

const secret = "private-env-value";
const envField: McpCredentialField = {
	kind: "env",
	name: "TEST_API_KEY",
	required: true,
	secret: true,
};
const headerField: McpCredentialField = {
	kind: "header",
	name: "X-Api-Key",
	required: true,
	secret: true,
};
const stdio: Extract<McpServer, { transport: "stdio" }> = {
	id: "child",
	transport: "stdio",
	runtime: "node",
	command: "fixture",
	args: [],
	permissions: [],
	credentialFields: [envField],
};
const remote: Extract<McpServer, { transport: "streamable-http" | "sse" }> = {
	id: "remote",
	transport: "streamable-http",
	auth: "none",
	permissions: [],
	url: "https://remote.invalid/mcp",
	credentialFields: [headerField],
};
const oauth: typeof remote = { ...remote, auth: "oauth", credentialFields: [] };
const signal = new AbortController().signal;
const sessionsToClose: ReturnType<typeof createSessions>[] = [];
const memory = (): SecretStore => {
	const values = new Map<string, string>();
	return {
		get: async (name) => ok(values.get(name)),
		set: async (name, value) => {
			values.set(name, value);
			return ok(undefined);
		},
		delete: async (name) => ok(values.delete(name)),
	};
};
const seed = async (
	secrets: SecretStore,
	server: McpServer,
	field: McpCredentialField,
) => {
	const saved = await createCredentialFields(secrets, tmpdir()).save(
		{
			expected: server,
			fields: [field],
			values: { [`${field.kind}:${field.name}`]: secret },
		},
		signal,
	);
	expect(saved.ok).toBe(true);
};
const setup = (servers: McpServer[], more: Partial<SessionDeps> = {}) => {
	const transport = InMemoryTransport.createLinkedPair()[0];
	const open = vi.fn<SessionDeps["open"]>(() => ({
		transport,
		stderr: () => `stderr ${secret} private-access private-refresh`,
		finishAuth: async () => {
			script.events.push("exchange");
			if (script.exchangeFails) throw new Error("private-exchange-error");
		},
	}));
	const logger = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	};
	const sessions = createSessions({
		moduleId: "mcp-client",
		version: "1",
		workspaceDir: tmpdir(),
		servers,
		open,
		logger,
		calls: createCalls(),
		...more,
	});
	sessionsToClose.push(sessions);
	return { sessions, open, logger };
};

beforeEach(() => {
	script.options.length = 0;
	script.events.length = 0;
	script.commitFails = false;
	script.exchangeFails = false;
	script.saved = false;
	script.publish = undefined;
	vi.spyOn(Client.prototype, "connect").mockImplementation(async () => {
		script.events.push("connect");
	});
	vi.spyOn(Client.prototype, "listTools").mockImplementation(async () => {
		script.events.push("list");
		return { tools: [] };
	});
	vi.spyOn(Client.prototype, "close").mockResolvedValue(undefined);
});
afterEach(async () => {
	await Promise.all(
		sessionsToClose.splice(0).map((sessions) => sessions.close()),
	);
	vi.restoreAllMocks();
});

describe("session credentials and OAuth admission", () => {
	it("refuses missing required fields before runtime, download or open", async () => {
		const ensure = {
			run: vi.fn(async () => ok({ binDir: "/runtime", command: "node" })),
		};
		const { sessions, open } = setup([stdio], { secrets: memory(), ensure });
		expect(await sessions.get(stdio.id, signal)).toMatchObject({ ok: false });
		expect(ensure.run).not.toHaveBeenCalled();
		expect(open).not.toHaveBeenCalled();
	});

	it("sanitizes a throwing runtime adapter before opening a child", async () => {
		const ensure = {
			run: vi.fn(async () => {
				throw new Error(secret);
			}),
		};
		const { sessions, open } = setup([{ ...stdio, credentialFields: [] }], {
			ensure,
		});
		const result = await sessions.get(stdio.id, signal);
		expect(result.ok).toBe(false);
		expect(JSON.stringify(result)).not.toContain(secret);
		expect(open).not.toHaveBeenCalled();
	});

	it("injects stored env only into its exact child and redacts it", async () => {
		const secrets = memory();
		await seed(secrets, stdio, envField);
		const other = { ...stdio, id: "other", credentialFields: [] };
		const prior = process.env.TEST_API_KEY;
		const { sessions, open } = setup([stdio, other], { secrets });
		expect((await sessions.get(stdio.id, signal)).ok).toBe(true);
		expect((await sessions.get(other.id, signal)).ok).toBe(true);
		expect(open.mock.calls[0]?.[0]).toMatchObject({
			env: { TEST_API_KEY: secret },
		});
		expect(open.mock.calls[1]?.[0]).not.toHaveProperty("env.TEST_API_KEY");
		expect(process.env.TEST_API_KEY).toBe(prior);
		expect(sessions.redact(secret)).toBe("[REDACTED]");
	});

	it("does not inherit credentials after endpoint or workspace changes", async () => {
		const secrets = memory();
		await seed(secrets, remote, headerField);
		const changed = { ...remote, url: "https://remote.invalid/other" };
		const { sessions, open } = setup([changed], { secrets });
		expect((await sessions.get(changed.id, signal)).ok).toBe(false);
		expect(open).not.toHaveBeenCalled();
		const second = setup([remote], {
			secrets,
			workspaceDir: parse(tmpdir()).root,
		});
		expect((await second.sessions.get(remote.id, signal)).ok).toBe(false);
		expect(second.open).not.toHaveBeenCalled();
	});

	it("wraps stored headers only for the exact endpoint and refuses redirects", async () => {
		const secrets = memory();
		await seed(secrets, remote, headerField);
		const requests: Request[] = [];
		const fetcher: typeof fetch = async (input, init) => {
			requests.push(new Request(input, init));
			return new Response("", {
				status: 302,
				headers: { location: "https://other.invalid" },
			});
		};
		const open = vi.fn<SessionDeps["open"]>(async (_server, options) => {
			await expect(options?.fetch?.(remote.url)).rejects.toThrow(/redirect/i);
			await expect(options?.fetch?.("https://other.invalid")).rejects.toThrow(
				/redirect/i,
			);
			throw new Error(secret);
		});
		const { sessions } = setup([remote], { secrets, fetch: fetcher, open });
		const result = await sessions.get(remote.id, signal);
		expect(requests[0]?.headers.get("X-Api-Key")).toBe(secret);
		expect(requests[1]?.headers.has("X-Api-Key")).toBe(false);
		expect(requests[0]?.redirect).toBe("manual");
		expect(JSON.stringify(result)).not.toContain(secret);
	});

	it("leaves noncredential plain HTTP fetch unchanged", async () => {
		const plain: McpServer = {
			...remote,
			url: "http://plain.invalid",
			credentialFields: [],
		};
		const fetcher: typeof fetch = vi.fn();
		const seen = vi.fn<SessionDeps["open"]>((_server, options) => {
			expect(options?.fetch).toBe(fetcher);
			return {
				transport: InMemoryTransport.createLinkedPair()[0],
				stderr: () => "",
			};
		});
		const { sessions } = setup([plain], { fetch: fetcher, open: seen });
		expect((await sessions.get(plain.id, signal)).ok).toBe(true);
	});

	it("uses the secure redirect-refusing wrapper for OAuth requests too", async () => {
		const fetcher: typeof fetch = vi.fn(
			async () => new Response("", { status: 302 }),
		);
		const open = vi.fn<SessionDeps["open"]>(async (_server, options) => {
			expect(options?.fetch).not.toBe(fetcher);
			await expect(
				options?.fetch?.("http://issuer.invalid/token"),
			).rejects.toThrow(/secure/i);
			expect(fetcher).not.toHaveBeenCalled();
			await expect(
				options?.fetch?.("https://issuer.invalid/token"),
			).rejects.toThrow(/redirect/i);
			throw new Error("private-access");
		});
		const { sessions } = setup([oauth], {
			secrets: memory(),
			authorize: async () => "valid",
			fetch: fetcher,
			open,
		});
		expect((await sessions.get(oauth.id, signal)).ok).toBe(false);
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(script.events).not.toContain("commit");
	});

	it("shares a fresh SSE destination set with the transport and credential fetch", async () => {
		const server: McpServer = { ...remote, transport: "sse" };
		const secrets = memory();
		await seed(secrets, server, headerField);
		const destinations: Set<string>[] = [];
		const requests: Request[] = [];
		const fetcher: typeof fetch = async (input, init) => {
			requests.push(new Request(input, init));
			return new Response("");
		};
		const send = "https://remote.invalid/messages";
		const open: SessionDeps["open"] = async (_server, options) => {
			const endpoints = options?.credentialEndpoints;
			if (!endpoints || !options?.fetch)
				throw new Error("Missing SSE credentials context");
			expect(endpoints.size).toBe(0);
			destinations.push(endpoints);
			await options.fetch(send);
			endpoints.add(send); // Script the transport's validated SDK send destination.
			await options.fetch(send);
			await options.fetch("https://remote.invalid/unrelated");
			return {
				transport: InMemoryTransport.createLinkedPair()[0],
				stderr: () => "",
			};
		};
		for (const _ of [0, 1]) {
			const { sessions } = setup([server], { secrets, fetch: fetcher, open });
			expect((await sessions.get(server.id, signal)).ok).toBe(true);
		}
		expect(destinations[0]).not.toBe(destinations[1]);
		expect(
			requests.map((request) => request.headers.get(headerField.name)),
		).toEqual([null, secret, null, null, secret, null]);
	});

	it("passes exact redirect and commits only after handshake and list", async () => {
		const { sessions } = setup([oauth], {
			secrets: memory(),
			authorize: async () => "valid",
			oauthRedirectUrl: "http://127.0.0.1:12345/callback/fixture",
		});
		expect((await sessions.get(oauth.id, signal)).ok).toBe(true);
		expect(script.options[0]).toMatchObject({
			interactive: true,
			server: oauth,
			workspaceDir: tmpdir(),
			redirectUrl: "http://127.0.0.1:12345/callback/fixture",
		});
		expect(script.events).toEqual(["connect", "list", "commit"]);
		expect(sessions.redact("private-access private-refresh")).toBe(
			"[REDACTED] [REDACTED]",
		);
	});

	it("commits the same staged flow after the post-sign-in connection", async () => {
		vi.mocked(Client.prototype.connect).mockRejectedValueOnce(
			new UnauthorizedError(),
		);
		const { sessions } = setup([oauth], {
			secrets: memory(),
			authorize: async () => "valid",
		});
		expect((await sessions.get(oauth.id, signal)).ok).toBe(true);
		expect(script.options).toHaveLength(1);
		expect(script.events).toEqual(["exchange", "connect", "list", "commit"]);
	});

	it.each(["list", "commit", "post-list", "post-commit"])(
		"closes the connected client after %s failure without secret echoes",
		async (phase) => {
			if (phase.startsWith("post"))
				vi.mocked(Client.prototype.connect).mockRejectedValueOnce(
					new UnauthorizedError(),
				);
			if (phase.endsWith("list"))
				vi.mocked(Client.prototype.listTools).mockRejectedValueOnce(
					new Error(secret),
				);
			else script.commitFails = true;
			const { sessions } = setup([oauth], {
				secrets: memory(),
				authorize: async () => "valid",
			});
			const result = await sessions.get(oauth.id, signal);
			expect(result.ok).toBe(false);
			expect(JSON.stringify(result)).not.toMatch(/private/);
			expect(Client.prototype.close).toHaveBeenCalled();
			expect(script.events.includes("commit")).toBe(phase.endsWith("commit"));
		},
	);

	it.each([undefined, "http://127.0.0.1:12345/callback/fixture"])(
		"limits desktop retries to one; CLI to three: %s",
		async (redirect) => {
			vi.mocked(Client.prototype.connect).mockRejectedValue(
				new UnauthorizedError(),
			);
			const authorize = vi.fn(async () => "invalid");
			const { sessions } = setup([oauth], {
				secrets: memory(),
				authorize,
				...(redirect ? { oauthRedirectUrl: redirect } : {}),
			});
			expect((await sessions.get(oauth.id, signal)).ok).toBe(false);
			expect(authorize).toHaveBeenCalledTimes(redirect ? 1 : 3);
			expect(script.events).not.toContain("commit");
		},
	);

	it("without a host never admits interactive registration and gives safe sign-in help", async () => {
		const { sessions, open } = setup([oauth], { secrets: memory() });
		const result = await sessions.get(oauth.id, signal);
		expect(script.options[0]?.interactive).toBe(false);
		expect(open).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			ok: false,
			error: { message: expect.stringMatching(/Settings|terminal/) },
		});
	});

	it("allows a previously granted noninteractive refresh and commits it after tools/list", async () => {
		script.saved = true;
		const { sessions } = setup([oauth], { secrets: memory() });
		expect((await sessions.get(oauth.id, signal)).ok).toBe(true);
		expect(script.options[0]?.interactive).toBe(false);
		expect(script.events).toEqual(["connect", "list", "commit"]);
	});

	it("sanitizes a throwing authorize hook and token exchange", async () => {
		vi.mocked(Client.prototype.connect).mockRejectedValue(
			new UnauthorizedError(),
		);
		for (const exchange of [false, true]) {
			script.exchangeFails = exchange;
			const { sessions } = setup([oauth], {
				secrets: memory(),
				oauthRedirectUrl: "http://127.0.0.1:12345/callback/fixture",
				authorize: async () => {
					if (!exchange) throw new Error(secret);
					return "valid";
				},
			});
			const result = await sessions.get(oauth.id, signal);
			expect(result.ok).toBe(false);
			expect(JSON.stringify(result)).not.toMatch(/private/);
		}
	});

	it("redacts exact values before progress masking", async () => {
		const secrets = memory();
		await seed(secrets, stdio, envField);
		const mask = { mask: vi.fn(async (text: string) => ({ text, masked: 0 })) };
		const { sessions, logger } = setup([stdio], { secrets, mask });
		expect((await sessions.get(stdio.id, signal)).ok).toBe(true);
		sessions
			.callOptions(stdio.id, "work", { signal }, "mcp.tools@1")
			.onprogress({ progress: 1, message: secret });
		await sessions.close();
		expect(mask.mask).toHaveBeenCalledWith("[REDACTED]");
		expect(JSON.stringify(logger.info.mock.calls)).not.toContain(secret);
	});

	it("redacts exact stderr values before masking a failed connection", async () => {
		const secrets = memory();
		await seed(secrets, stdio, envField);
		const mask = { mask: vi.fn(async (text: string) => ({ text, masked: 0 })) };
		const open: SessionDeps["open"] = () => ({
			transport: InMemoryTransport.createLinkedPair()[0],
			stderr: () => secret,
		});
		vi.mocked(Client.prototype.connect).mockRejectedValueOnce(
			new Error(secret),
		);
		const { sessions } = setup([stdio], { secrets, mask, open });
		const result = await sessions.get(stdio.id, signal);
		expect(result.ok).toBe(false);
		expect(mask.mask).toHaveBeenCalledWith("[REDACTED]");
		expect(JSON.stringify(result)).not.toContain(secret);
	});

	it("aborts a pending open, rejects reopening, and closes a late transport", async () => {
		const deferred =
			Promise.withResolvers<Awaited<ReturnType<SessionDeps["open"]>>>();
		const started = Promise.withResolvers<void>();
		const transport = InMemoryTransport.createLinkedPair()[0];
		const close = vi.spyOn(transport, "close");
		const open = vi.fn<SessionDeps["open"]>(() => {
			started.resolve();
			return deferred.promise;
		});
		const { sessions } = setup([{ ...stdio, credentialFields: [] }], { open });
		const pending = sessions.get(stdio.id, signal);
		await started.promise;
		await sessions.close();
		expect((await pending).ok).toBe(false);
		expect((await sessions.get(stdio.id, signal)).ok).toBe(false);
		expect(open).toHaveBeenCalledTimes(1);
		deferred.resolve({ transport, stderr: () => secret });
		await vi.waitFor(() => expect(close).toHaveBeenCalled());
	});

	it.each([false, true])(
		"drains cancelled publication and reports rollback failure: %s",
		async (rollbackFails) => {
			const stored = memory();
			const publishing = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const name = "session-publication";
			const secrets: SecretStore = {
				...stored,
				set: async (key, value) => {
					if (key === `${name}/manifest`) {
						publishing.resolve();
						await release.promise;
					}
					return stored.set(key, value);
				},
				delete: (key) =>
					key === `${name}/manifest` && rollbackFails
						? Promise.resolve(err({ code: "secret_failed", message: secret }))
						: stored.delete(key),
			};
			script.publish = async (options) => {
				const result = await createCredentialRecords(secrets).write(
					name,
					"private-record",
					options.signal,
				);
				return result.ok
					? ok(undefined)
					: err({ code: "io", message: "Commit failed" });
			};
			const controller = new AbortController();
			const { sessions } = setup([oauth], {
				secrets,
				authorize: async () => "valid",
			});
			const getting = sessions.get(oauth.id, controller.signal);
			await publishing.promise;
			controller.abort();
			expect((await getting).ok).toBe(false);
			let closed = false;
			let drained = false;
			const closing = sessions.close().then(() => {
				closed = true;
			});
			const draining = sessions.drain().then((result) => {
				drained = true;
				return result;
			});
			try {
				await Promise.resolve();
				expect(closed).toBe(false);
				expect(drained).toBe(false);
			} finally {
				release.resolve();
			}
			await closing;
			const result = await draining;
			expect(result.ok).toBe(!rollbackFails);
			expect(await sessions.drain()).toEqual(result);
			expect(JSON.stringify(result)).not.toContain(secret);
			if (!rollbackFails)
				expect(await stored.get(`${name}/manifest`)).toEqual(ok(undefined));
		},
	);

	it("retires A on abort and never lets its late close evict B", async () => {
		const a = new AbortController();
		const { sessions, open } = setup([{ ...stdio, credentialFields: [] }]);
		const first = await sessions.get(stdio.id, a.signal);
		if (!first.ok) throw new Error("Missing first session");
		a.abort();
		expect(Client.prototype.close).toHaveBeenCalled();
		const second = await sessions.get(stdio.id, signal);
		if (!second.ok) throw new Error("Missing replacement session");
		expect(second.value.client).not.toBe(first.value.client);
		expect(open).toHaveBeenCalledTimes(2);
		first.value.client.onclose?.();
		expect(await sessions.get(stdio.id, signal)).toBe(second);
		expect(open).toHaveBeenCalledTimes(2);
	});

	it("removes the initial caller's abort listener after a remote close", async () => {
		const a = new AbortController();
		const { sessions, open } = setup([{ ...stdio, credentialFields: [] }]);
		const first = await sessions.get(stdio.id, a.signal);
		if (!first.ok) throw new Error("Missing first session");
		first.value.client.onclose?.();
		const second = await sessions.get(stdio.id, signal);
		vi.mocked(Client.prototype.close).mockClear();
		a.abort();
		expect(Client.prototype.close).not.toHaveBeenCalled();
		expect(await sessions.get(stdio.id, signal)).toBe(second);
		expect(open).toHaveBeenCalledTimes(2);
	});

	it("caller cancellation aborts an in-flight handshake", async () => {
		const started = Promise.withResolvers<void>();
		vi.mocked(Client.prototype.connect).mockImplementation(
			(_transport, options) =>
				new Promise((_resolve, reject) => {
					started.resolve();
					options?.signal?.addEventListener(
						"abort",
						() => reject(new Error(secret)),
						{ once: true },
					);
				}),
		);
		const controller = new AbortController();
		const { sessions } = setup([{ ...stdio, credentialFields: [] }]);
		const pending = sessions.get(stdio.id, controller.signal);
		await started.promise;
		controller.abort(secret);
		expect(await pending).toMatchObject({ ok: false, error: { code: "io" } });
		expect(Client.prototype.close).toHaveBeenCalled();
	});
});
