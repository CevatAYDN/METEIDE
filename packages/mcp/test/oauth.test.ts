import { tmpdir } from "node:os";
import {
	err,
	type McpStatusAdapter,
	type McpToolsAdapter,
	ok,
	type SecretStore,
} from "@mete/contracts";
import {
	McpServer,
	WebStandardStreamableHTTPServerTransport,
} from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMcpClientModule, type McpClientOptions } from "../src/module.js";
import { moduleContext } from "./helpers/context.js";

const BASE = "https://mcp.example";
// A JWT pair can be longer than the Windows keychain keeps in one entry (1280 characters, measured).
const TOKEN = "t".repeat(3000);
const REFRESHED = "r".repeat(3000);
const KEYCHAIN_LIMIT = 1280;
const signal = new AbortController().signal;
const remote = {
	id: "remote",
	transport: "streamable-http",
	url: `${BASE}/mcp`,
	auth: "oauth",
	permissions: [],
};

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});

// A remote MCP server that asks for a bearer token, and the authorization server beside it, as a fake fetch.
const remoteServer = async () => {
	// Each initialize opens a session of its own, as a real server does.
	const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();
	const session = async (req: Request) => {
		const known = sessions.get(req.headers.get("mcp-session-id") ?? "");
		if (known) return known;
		const id = `session-${sessions.size + 1}`;
		const mcp = new McpServer({ name: "remote", version: "1.0.0" });
		mcp.registerTool(
			"echo",
			{
				description: "Echoes",
				inputSchema: z.object({ text: z.string() }),
			},
			async ({ text }) => ({ content: [{ type: "text", text }] }),
		);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: () => id,
		});
		await mcp.connect(transport);
		sessions.set(id, transport);
		return transport;
	};
	const seen = { registered: 0, tokens: 0, refreshes: 0 };
	// What the client registered as: the spec asks a native client to say so (ADR-163).
	const registration: { application_type?: unknown } = {};
	// The one access token the server accepts; `expire` makes the one it handed out stop working.
	const accepted = { token: TOKEN };
	const metadata = (pathname: string) => {
		if (pathname.startsWith("/.well-known/oauth-protected-resource"))
			return json({ resource: `${BASE}/mcp`, authorization_servers: [BASE] });
		if (!pathname.startsWith("/.well-known/oauth-authorization-server"))
			return undefined;
		return json({
			issuer: BASE,
			authorization_endpoint: `${BASE}/authorize`,
			token_endpoint: `${BASE}/token`,
			registration_endpoint: `${BASE}/register`,
			response_types_supported: ["code"],
			grant_types_supported: ["authorization_code", "refresh_token"],
			code_challenge_methods_supported: ["S256"],
			token_endpoint_auth_methods_supported: ["none"],
		});
	};
	const refresh = (form: URLSearchParams) => {
		if (form.get("refresh_token") !== "refresh-1")
			return json({ error: "invalid_grant" }, 400);
		seen.refreshes += 1;
		accepted.token = REFRESHED;
		return json({
			access_token: REFRESHED,
			refresh_token: "refresh-2",
			token_type: "Bearer",
		});
	};
	const grant = (form: URLSearchParams) =>
		form.get("code") === "good-code"
			? json({
					access_token: TOKEN,
					refresh_token: "refresh-1",
					token_type: "Bearer",
				})
			: json({ error: "invalid_grant" }, 400);
	const oauth = async (req: Request, pathname: string) => {
		if (pathname === "/register") {
			seen.registered += 1;
			const body = await req.json();
			registration.application_type = body.application_type;
			return json({ ...body, client_id: "client-1" }, 201);
		}
		if (pathname !== "/token") return undefined;
		seen.tokens += 1;
		const form = new URLSearchParams(await req.text());
		return form.get("grant_type") === "refresh_token"
			? refresh(form)
			: grant(form);
	};
	const mcpEndpoint = async (req: Request, pathname: string) => {
		if (pathname !== "/mcp") return new Response("", { status: 404 });
		if (req.headers.get("authorization") === `Bearer ${accepted.token}`)
			return (await session(req)).handleRequest(req);
		const resource = `${BASE}/.well-known/oauth-protected-resource`;
		return new Response("", {
			status: 401,
			headers: { "WWW-Authenticate": `Bearer resource_metadata="${resource}"` },
		});
	};
	const answer = async (req: Request) => {
		const { pathname } = new URL(req.url);
		return (
			metadata(pathname) ??
			(await oauth(req, pathname)) ??
			mcpEndpoint(req, pathname)
		);
	};
	const fetchFake: typeof fetch = (input, init) =>
		answer(new Request(input, init));
	return {
		fetch: fetchFake,
		seen,
		registration,
		expire: () => {
			accepted.token = "expired";
		},
	};
};

const memorySecrets = (): SecretStore & { names: () => string[] } => {
	const m = new Map<string, string>();
	return {
		get: async (n) => ok(m.get(n)),
		set: async (n, v) =>
			v.length > KEYCHAIN_LIMIT
				? err({ code: "secret_failed", message: `${n}: value is too long` })
				: ok(void m.set(n, v)),
		delete: async (n) => ok(m.delete(n)),
		names: () => [...m.keys()],
	};
};

// The tokens as the client keeps them: numbered pieces, `<name>` holding how many.
const savedTokens = async (secrets: SecretStore) => {
	const name = `mcp/${BASE}/tokens`;
	const count = await secrets.get(name);
	let text = "";
	for (let i = 0; count.ok && i < Number(count.value); i++) {
		const piece = await secrets.get(`${name}/${i}`);
		text += piece.ok ? (piece.value ?? "") : "";
	}
	return z
		.object({ access_token: z.string(), refresh_token: z.string() })
		.parse(JSON.parse(text));
};

// What the browser lands on after the user allows access: the code, the state the sign-in sent and,
// from a server that names itself (RFC 9207), its issuer.
const landing = (
	authUrl: string,
	code = "good-code",
	state?: string,
	iss?: string,
) => {
	const sent = new URL(authUrl).searchParams.get("state") ?? "";
	const named = iss ? `&iss=${encodeURIComponent(iss)}` : "";
	return `http://127.0.0.1/callback?code=${code}&state=${state ?? sent}${named}`;
};

const start = async (
	server: Awaited<ReturnType<typeof remoteServer>>,
	secrets: SecretStore,
	more: Partial<McpClientOptions> = {},
) => {
	const module = createMcpClientModule({
		workspaceDir: tmpdir(),
		builtInServers: [],
		fetch: server.fetch,
		...more,
	});
	const { ctx, registry } = moduleContext(
		"allow",
		{ mcp: { servers: [remote] } },
		undefined,
		secrets,
	);
	await module.activate(ctx);
	const r = registry.resolve<McpToolsAdapter>("mcp.tools@1");
	const echo = async () => {
		const call = { server: "remote", tool: "echo", args: { text: "hi" } };
		const out = await (r.ok ? r.value[0].impl : undefined)?.call(call, {
			signal,
		});
		if (!out?.ok) return out?.error.message ?? "no adapter";
		const block = out.value.content[0];
		return block?.type === "text" ? block.text : "";
	};
	const st = registry.resolve<McpStatusAdapter>("mcp.status@1");
	const status = () =>
		(st.ok ? st.value[0].impl : undefined)?.test("remote", signal);
	return { module, echo, status };
};

describe("mcp-client OAuth", () => {
	it("signs in once through the host, then reuses the saved tokens without asking", async () => {
		const server = await remoteServer();
		const secrets = memorySecrets();
		const urls: string[] = [];
		const authorize = async (_id: string, url: string) => {
			urls.push(url);
			return landing(url);
		};
		const first = await start(server, secrets, { authorize });
		expect(await first.echo()).toBe("hi");
		const sent = new URL(urls[0] ?? "").searchParams;
		expect(urls).toHaveLength(1);
		expect(sent.get("client_id")).toBe("client-1");
		expect(sent.get("code_challenge_method")).toBe("S256");
		expect(sent.get("redirect_uri")).toBe("http://127.0.0.1/callback");
		expect(server.registration.application_type).toBe("native");
		// The token is longer than one keychain entry, so it is stored in numbered pieces.
		const names = secrets.names();
		expect(names).toContain(`mcp/${BASE}/client`);
		expect(names).toContain(`mcp/${BASE}/tokens`);
		expect(
			names.filter((n) => n.startsWith(`mcp/${BASE}/tokens/`)).length,
		).toBeGreaterThan(2);
		await first.module.deactivate();
		// Another process, another module: no host to ask, the keychain has the tokens.
		const second = await start(server, secrets);
		expect(await second.echo()).toBe("hi");
		expect(server.seen).toEqual({ registered: 1, tokens: 1, refreshes: 0 });
		await second.module.deactivate();
	});

	it("renews an expired access token with the refresh token, without asking the user", async () => {
		const server = await remoteServer();
		const secrets = memorySecrets();
		const first = await start(server, secrets, {
			authorize: async (_id, url) => landing(url),
		});
		expect(await first.echo()).toBe("hi");
		await first.module.deactivate();
		server.expire();
		let asked = 0;
		const second = await start(server, secrets, {
			authorize: async () => {
				asked += 1;
				return undefined;
			},
		});
		expect(await second.echo()).toBe("hi");
		expect(asked).toBe(0);
		expect(server.seen.refreshes).toBe(1);
		const saved = await savedTokens(secrets);
		expect(saved.access_token).toBe(REFRESHED);
		expect(saved.refresh_token).toBe("refresh-2");
		await second.module.deactivate();
	});

	it("rejects an address that does not carry this sign-in's state, or that the server refused", async () => {
		const server = await remoteServer();
		const forged = await start(server, memorySecrets(), {
			authorize: async (_id, url) => landing(url, "good-code", "forged"),
		});
		expect(await forged.echo()).toMatch(/does not belong to this sign-in/);
		await forged.module.deactivate();
		const denied = await start(server, memorySecrets(), {
			authorize: async (_id, url) =>
				`http://127.0.0.1/callback?error=access_denied&state=${new URL(url).searchParams.get("state")}`,
		});
		expect(await denied.echo()).toMatch(/access_denied/);
		await denied.module.deactivate();
		const bare = await start(server, memorySecrets(), {
			authorize: async () => "not an address",
		});
		expect(await bare.echo()).toMatch(/whole address/);
		await bare.module.deactivate();
	});

	it("takes the code only from the issuer it signs in to, when the address names one", async () => {
		const mixed = await remoteServer();
		const other = await start(mixed, memorySecrets(), {
			authorize: async (_id, url) =>
				landing(url, "good-code", undefined, "https://evil.example"),
		});
		expect(await other.echo()).toMatch(/issuer/i);
		expect(mixed.seen.tokens).toBe(0);
		await other.module.deactivate();
		const named = await start(await remoteServer(), memorySecrets(), {
			authorize: async (_id, url) => landing(url, "good-code", undefined, BASE),
		});
		expect(await named.echo()).toBe("hi");
		await named.module.deactivate();
	});

	it("asks again at once, with a fresh address, after a refused one and tells the host why", async () => {
		const server = await remoteServer();
		const asked: { url: string; refused: string | undefined }[] = [];
		const answers = [
			(url: string) =>
				landing(url, "good-code", undefined, "https://evil.example"),
			(url: string) => landing(url),
		];
		const s = await start(server, memorySecrets(), {
			authorize: async (_id, url, _signal, refused) => {
				asked.push({ url, refused });
				return answers[asked.length - 1]?.(url);
			},
		});
		expect(await s.echo()).toBe("hi");
		expect(asked).toHaveLength(2);
		expect(asked[0]?.refused).toBeUndefined();
		expect(asked[1]?.refused).toMatch(/issuer/i);
		const state = (u?: string) => new URL(u ?? "").searchParams.get("state");
		expect(state(asked[1]?.url)).not.toBe(state(asked[0]?.url));
		expect(server.seen.tokens).toBe(1);
		await s.module.deactivate();
	});

	it("stops after three refused addresses and asks again, with the reason, on the next connection", async () => {
		const server = await remoteServer();
		const reasons: (string | undefined)[] = [];
		const s = await start(server, memorySecrets(), {
			authorize: async (_id, url, _signal, refused) => {
				reasons.push(refused);
				return landing(url, "good-code", "forged");
			},
		});
		expect(await s.echo()).toMatch(/does not belong to this sign-in/);
		expect(reasons).toHaveLength(3);
		expect(await s.echo()).toMatch(/does not belong to this sign-in/);
		expect(reasons).toHaveLength(6);
		expect(reasons[3]).toMatch(/does not belong to this sign-in/);
		expect(server.seen.tokens).toBe(0);
		await s.module.deactivate();
	});

	it("does not ask again for a sign-in the user gave up", async () => {
		const server = await remoteServer();
		let asked = 0;
		const s = await start(server, memorySecrets(), {
			authorize: async () => {
				asked += 1;
				return undefined;
			},
		});
		expect(await s.echo()).toMatch(/no sign-in was given/);
		expect(await s.echo()).toMatch(/no sign-in was given/);
		expect(asked).toBe(1);
		expect(server.seen.tokens).toBe(0);
		await s.module.deactivate();
	});

	it("says to sign in once in a terminal when there is neither a host nor saved tokens", async () => {
		const server = await remoteServer();
		const s = await start(server, memorySecrets());
		expect(await s.echo()).toMatch(/sign in.*mete run.*terminal/);
		await s.module.deactivate();
	});

	it("tells the Settings card's Test to sign in once in a terminal, and the tools once signed in (ADR-164)", async () => {
		const server = await remoteServer();
		const secrets = memorySecrets();
		const bare = await start(server, secrets);
		const before = await bare.status();
		expect(!before?.ok && before?.error.message).toMatch(
			/sign in.*mete run.*terminal/,
		);
		await bare.module.deactivate();
		const signedIn = await start(server, secrets, {
			authorize: async (_id, url) => landing(url),
		});
		expect(await signedIn.echo()).toBe("hi");
		const again = await start(server, secrets);
		const after = await again.status();
		expect(after?.ok && after.value.tools).toEqual(["echo"]);
		await signedIn.module.deactivate();
		await again.module.deactivate();
	});
});
