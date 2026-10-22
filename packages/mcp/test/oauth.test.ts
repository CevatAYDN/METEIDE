import { tmpdir } from "node:os";
import {
	err,
	type McpToolsAdapter,
	ok,
	type SecretStore,
} from "@mete/contracts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMcpClientModule, type McpClientOptions } from "../src/module.js";
import { moduleContext } from "./helpers/context.js";

const BASE = "https://mcp.example";
// A JWT pair can be longer than the Windows keychain keeps in one entry (1280 characters, measured).
const TOKEN = "t".repeat(3000);
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
			{ description: "Echoes", inputSchema: { text: z.string() } },
			async ({ text }) => ({ content: [{ type: "text", text }] }),
		);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: () => id,
		});
		await mcp.connect(transport);
		sessions.set(id, transport);
		return transport;
	};
	const seen = { registered: 0, tokens: 0 };
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
	const oauth = async (req: Request, pathname: string) => {
		if (pathname === "/register") {
			seen.registered += 1;
			return json({ ...(await req.json()), client_id: "client-1" }, 201);
		}
		if (pathname !== "/token") return undefined;
		seen.tokens += 1;
		const form = new URLSearchParams(await req.text());
		return form.get("code") === "good-code"
			? json({ access_token: TOKEN, token_type: "Bearer" })
			: json({ error: "invalid_grant" }, 400);
	};
	const mcpEndpoint = async (req: Request, pathname: string) => {
		if (pathname !== "/mcp") return new Response("", { status: 404 });
		if (req.headers.get("authorization") === `Bearer ${TOKEN}`)
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
	return { fetch: fetchFake, seen };
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

// What the browser lands on after the user allows access: the code, and the state the sign-in sent.
const landing = (authUrl: string, code = "good-code", state?: string) => {
	const sent = new URL(authUrl).searchParams.get("state") ?? "";
	return `http://127.0.0.1/callback?code=${code}&state=${state ?? sent}`;
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
	return { module, echo };
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
		expect(server.seen).toEqual({ registered: 1, tokens: 1 });
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

	it("says to sign in once in a terminal when there is neither a host nor saved tokens", async () => {
		const server = await remoteServer();
		const s = await start(server, memorySecrets());
		expect(await s.echo()).toMatch(/sign in.*mete run.*terminal/);
		await s.module.deactivate();
	});
});
